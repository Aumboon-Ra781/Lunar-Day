import numpy as np
import torch
import cv2
import os
import time
import logging
from threading import Lock
from flask import Blueprint, app, request, jsonify, send_from_directory
import segmentation_models_pytorch as smp
from flask_jwt_extended import jwt_required, get_jwt_identity
import mysql.connector
from config.database import get_db_connection
from PIL import Image, ImageDraw, ImageFont
import uuid
from flask import send_from_directory
# ==============================
# INIT
# ==============================
analysis_bp = Blueprint("analysis", __name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL_PATH = os.path.join(os.getcwd(), "incep_exp12.pth")

IMG_SIZE = 512
STD_BASE_THRESHOLD = 33.20
CONF_THRESHOLD = 0.3
RED_RATIO_LIMIT = 0.02

# brightness thresholds for dynamic std
BRIGHTNESS_HIGH = 150
BRIGHTNESS_LOW = 130

UPLOAD_FOLDER = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# FILE VALIDATION
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}
MAX_FILE_SIZE = 10 * 1024 * 1024

# AREA CONFIG
MIN_AREA = 500


# แปลงผล AI (EN) → ภาษาไทย สำหรับแสดงผล
AI_RESULT_TH = {
    "clot": "ลิ่มเลือด",
    "tissue": "เนื้อเยื่อ",
    "mixed": "พบลิ่มเลือดและเนื้อเยื่อ",
    "negative space": "ไม่พบลิ่มเลือดและเนื้อเยื่อ",
}

model = None
model_lock = Lock()


DB_ADVICE = {
    "ฉุกเฉิน": "แนะนำให้เข้ารับการตรวจประเมินจากแพทย์โดยเร็วที่สุดเนื่องจากอาการเลือดออกหรือปวดท้องร่วมกับความเสี่ยงตั้งครรภ์อาจสัมพันธ์กับภาวะแทรกซ้อนที่จำเป็นต้องได้รับการดูแลทางการแพทย์อย่างใกล้ชิด",
    "เสี่ยงสูง": "ควรปรึกษาสูตินรีแพทย์เพื่อการวินิจฉัยเพิ่มเติมเนื่องจากลักษณะเลือดออกหรืออาการปวดที่พบ อาจสัมพันธ์กับความผิดปกติของมดลูกหรือภาวะเลือดออกมากที่ควรได้รับการตรวจหาสาเหตุ",
    "เสี่ยงปานกลาง": "แนะนำให้ติดตามอาการและจดบันทึกรอบเดือนต่อเนื่องควรสังเกตความเปลี่ยนแปลงใน 1-2 รอบเดือนถัดไป หากอาการยังคงอยู่ ไม่สม่ำเสมอ หรือรบกวนการใช้ชีวิตประจำวัน แนะนำให้ปรึกษาแพทย์เมื่อสะดวก",
    "ปกติ": "วิเคราะห์เบื้องต้นอยู่ในเกณฑ์ทั่วไปยังไม่พบข้อบ่งชี้ความเสี่ยงที่น่ากังวลในขณะนี้แนะนำให้ดูแลสุขภาพ จดบันทึกประจำเดือนสม่ำเสมอ และเข้ารับการตรวจคัดกรองสุขภาพประจำปีตามปกติ",
}


ALLOWED_VALUES = {
    "q1": {"low", "normal", "high"},
    "q2": {"short", "normal", "long"},
    "q3": {"short", "normal", "long"},
    "q4": {"spotting", "postcoital", "none"},
    "q5": {"none", "mild", "severe"},
    "q6": {"none", "mild", "severe"},
    "q7": {
        "palpitation",
        "nausea",
        "fever",
        "breast",
        "urine",
        "bowel",
        "discharge",
    },
    "q8": {"no_sex", "protected", "unprotected", "both", "failure"},
    "q9": {"pregnant", "not_pregnant", "unsure"},
    "q10": {"small", "large"},
}
# ==============================
# HELPERS
# ==============================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_model():
    global model
    with model_lock:
        if model is None:
            try:
                m = smp.Unet(
                    encoder_name="inceptionresnetv2", classes=3, activation=None
                )
                m.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
                m.to(DEVICE).eval()
                model = m
            except Exception:
                logger.exception("โหลดโมเดลล้มเหลว")
                raise
    return model


def calculate_dynamic_std(img_rgb):
    img_gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    brightness = np.mean(img_gray)
    tolerance = (
        2.0
        if brightness > BRIGHTNESS_HIGH
        else (1.20 if brightness < BRIGHTNESS_LOW else 1.50)
    )
    return STD_BASE_THRESHOLD * tolerance


def run_inference(img):
    model_inst = get_model()
    input_tensor = (
        torch.from_numpy(img).permute(2, 0, 1).float().unsqueeze(0).to(DEVICE) / 255
    )

    with torch.no_grad():
        output = model_inst(input_tensor)
        prob = torch.softmax(output, dim=1)
        conf, mask = torch.max(prob, dim=1)

    mask_np = mask[0].cpu().numpy()

    conf_np = conf[0].cpu().numpy()
    
    detected = (mask_np > 0) & (conf_np > CONF_THRESHOLD)
    
    if np.any(detected):
        avg_conf = np.mean(conf_np[detected])
    else:
        background_pixels = mask_np == 0
        if np.any(background_pixels):
            avg_conf = np.mean(conf_np[background_pixels])
        else:
            avg_conf = np.mean(conf_np)
    

    return mask_np, conf_np, float(avg_conf)


def validate_ai_findings(mask, conf, img, std_limit):
    found_clot = False
    found_tissue = False

    for cls_id in [1, 2]:
        binary = ((mask == cls_id) & (conf > CONF_THRESHOLD)).astype(np.uint8)
        contours, _ = cv2.findContours(
            binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < MIN_AREA:
                continue
            m_temp = np.zeros(img.shape[:2], np.uint8)
            cv2.drawContours(m_temp, [cnt], -1, 255, -1)
            std_val = np.std(img[m_temp > 0])
           
           
            if cls_id == 1 and std_val <= std_limit:
                    found_clot = True
            elif cls_id == 2 :
                    found_tissue = True

    if found_clot and found_tissue:
        return "mixed"
    elif found_clot:
        return "clot"
    elif found_tissue:
        return "tissue"
    else:
        return "negative space"


def validate_answers(answers, ai_res, q8):
    errors = []

    for q in ["q1", "q2", "q3", "q4", "q5", "q6", "q8"]:
        val = answers.get(q)
        if not val:
            errors.append(f"{q} กรุณากรอกข้อมูลอาการให้ครบถ้วน")
        elif val not in ALLOWED_VALUES[q]:
            errors.append(f"{q} ค่าไม่ถูกต้อง")

    if answers.get("q7"):
        for v in answers.get("q7"):
            if v not in ALLOWED_VALUES["q7"]:
                errors.append(f"q7 ค่า '{v}' ไม่ถูกต้อง")

    # ตรวจ Q9 เมื่อมีเพศสัมพันธ์
    if q8 != "no_sex":
        if not answers.get("q9"):
            errors.append("กรุณากรอกข้อมูลอาการให้ครบถ้วน")

    # ตรวจ Q10 เมื่อ ai_result = clot
    if ai_res == "clot":
        if not answers.get("q10"):
            errors.append("กรุณากรอกข้อมูลอาการให้ครบถ้วน")
    if ai_res != "clot":
        answers["q10"] = None

    return errors


# ==============================
# MEDICAL LOGIC
# ==============================
DISEASES = [
    {
        "name": "ภาวะประจำเดือนปกติ",
        "risk": "ปกติ",
        "group": 1,
        "criteria": {
            "q1": {"normal"},
            "q2": {"normal"},
            "q3": {"normal"},
            "q4": {"none"},
            "q5": {"none", "mild", "severe"},
            "q6": {"none", "mild"},
        },
    },
    {
        "name": "ติ่งเนื้อเยื่อบุโพรงมดลูก",
        "risk": "เสี่ยงปานกลาง",
        "group": 2,
        "criteria": {
            "q1": {"high", "low"},
            "q2": {"long", "short"},
            "q3": {"short", "long"},
            "q4": {"spotting", "postcoital"},
            "q5": {"severe"},
            "q6": {"none", "mild", "severe"},
            "q7": {"discharge"},
        },
    },
    {
        "name": "เยื่อบุโพรงมดลูกหนาตัว",
        "risk": "เสี่ยงปานกลาง",
        "group": 2,
        "criteria": {
            "q1": {"high", "low"},
            "q2": {"long", "short"},
            "q3": {"short", "long"},
            "q4": {"spotting"},
            "q5": {"severe"},
            "q6": {"severe"},
        },
    },
    {
        "name": "เนื้องอกมดลูก",
        "risk": "เสี่ยงปานกลาง",
        "group": 2,
        "criteria": {
            "q1": {"high", "low"},
            "q2": {"long", "short"},
            "q3": {"short", "long"},
            "q4": {"spotting"},
            "q5": {"severe"},
            "q6": {"mild", "severe"},
            "q7": {"urine", "bowel"},
        },
    },
    {
        "name": "ฮอร์โมนไม่สมดุล",
        "risk": "เสี่ยงปานกลาง",
        "group": 2,
        "criteria": {
            "q1": {"high", "low"},
            "q2": {"long", "short"},
            "q3": {"long", "short"},
            "q4": {"spotting"},
            "q5": {"severe"},
            "q6": {"mild", "severe"},
        },
    },
    {
        "name": "เยื่อบุโพรงมดลูกเจริญผิดที่",
        "risk": "เสี่ยงปานกลาง",
        "group": 2,
        "criteria": {
            "q1": {"high", "low"},
            "q2": {"long", "short"},
            "q3": {"long", "short"},
            "q4": {"spotting"},
            "q5": {"severe"},
            "q6": {"severe"},
            "q7": {"bowel", "nausea"},
        },
    },
    {
        "name": "อุ้งเชิงกรานอักเสบ",
        "risk": "เสี่ยงสูง",
        "group": 2,
        "criteria": {
            "q1": {"high", "low"},
            "q2": {"long", "short"},
            "q3": {"long", "short"},
            "q4": {"spotting", "postcoital"},
            "q5": {"severe"},
            "q6": {"mild", "severe"},
            "q7": {"urine", "fever", "discharge", "nausea"},
        },
    },
    {
        "name": "แท้งคุกคาม",
        "risk": "ฉุกเฉิน",
        "group": 3,
        "criteria": {
            "q4": {"spotting"},
            "q6": {"severe", "mild"},
        },
    },
    {
        "name": "ท้องนอกมดลูก",
        "risk": "ฉุกเฉิน",
        "group": 3,
        "criteria": {
            "q4": {"spotting"},
            "q6": {"severe"},
            "q7": {"palpitation", "breast", "nausea"},
        },
    },
    {
        "name": "ภาวะแท้งไม่สมบูรณ์",
        "risk": "ฉุกเฉิน",
        "group": 3,
        "criteria": {
            "q4": {"spotting"},
            "q6": {"severe"},
            "q7": {"fever", "discharge", "nausea"},
        },
    },
]

# ลำดับความรุนแรง
RISK_ORDER = {"ปกติ": 0, "เสี่ยงปานกลาง": 1, "เสี่ยงสูง": 2, "ฉุกเฉิน": 3}

AI_DISEASE_FILTER = {
    ("clot", "small"): {"ภาวะประจำเดือนปกติ", "แท้งคุกคาม", "ท้องนอกมดลูก"},
    ("clot", "large"): {
        "ติ่งเนื้อเยื่อบุโพรงมดลูก",
        "เยื่อบุโพรงมดลูกหนาตัว",
        "เนื้องอกมดลูก",
        "ฮอร์โมนไม่สมดุล",
        "เยื่อบุโพรงมดลูกเจริญผิดที่",
        "ท้องนอกมดลูก",
        "ภาวะแท้งไม่สมบูรณ์",
    },
    ("tissue", None): {
        "ติ่งเนื้อเยื่อบุโพรงมดลูก",
        "เยื่อบุโพรงมดลูกหนาตัว",
        "แท้งคุกคาม",
        "ท้องนอกมดลูก",
        "ภาวะแท้งไม่สมบูรณ์",
    },
    ("negative space", None): {
        "ภาวะประจำเดือนปกติ",
        "ติ่งเนื้อเยื่อบุโพรงมดลูก",
        "เยื่อบุโพรงมดลูกหนาตัว",
        "ฮอร์โมนไม่สมดุล",
        "เยื่อบุโพรงมดลูกเจริญผิดที่",
        "อุ้งเชิงกรานอักเสบ",
        "แท้งคุกคาม",
        "ท้องนอกมดลูก",
    },
    ("mixed", None): {
        "ติ่งเนื้อเยื่อบุโพรงมดลูก",
        "เยื่อบุโพรงมดลูกหนาตัว",
        "ท้องนอกมดลูก",
        "ภาวะแท้งไม่สมบูรณ์",
        "แท้งคุกคาม",
    },
}


def _eligible_groups(q8, q9):
    if q8 == "no_sex":
        return {1, 2}
    if q9 == "pregnant":
        return {2, 3}
    if q9 == "unsure":
        return {1, 2, 3}
    # มีเพศสัมพันธ์ + ไม่ตั้งครรภ์
    return {1, 2}


def screen_symptoms(ai_result, answers):
    q8 = answers.get("q8")
    q9 = answers.get("q9")
    q7_ans = set(answers.get("q7") or [])

    asked = {"q1", "q2", "q3", "q4", "q5", "q6"}
    if q7_ans:  
        asked.add("q7")
    if q8 != "no_sex":
        asked.add("q9")
    if ai_result == "clot":
        asked.add("q10")

    eligible = _eligible_groups(q8, q9)

    q10_val = answers.get("q10") if ai_result == "clot" else None
    filter_key = (ai_result, q10_val)
    allowed_diseases = AI_DISEASE_FILTER.get(filter_key, set())

    results = []
    for d in DISEASES:
        if d["group"] not in eligible:
            continue

        if allowed_diseases and d["name"] not in allowed_diseases:
            continue
        total = 0
        matched = 0
        matched_details = []
        for q, allowed in d["criteria"].items():
            if q not in asked:
                continue  
            total += 1
            if q == "q7":
                if q7_ans & allowed:  
                    intersect = q7_ans & allowed
                    matched += 1
                    matched_details.append(f"Q7 (อาการร่วม): {', '.join(intersect)}")
            elif answers.get(q) in allowed:
                matched += 1
                matched_details.append(f"{q.upper()}: {answers.get(q)}")
        if total and matched * 3 >= total * 2:
            results.append(
                {
                    "disease": d["name"],
                    "risk_level": d["risk"],
                    "match_percent": round(matched / total * 100, 1),
                    "matched_count": f"ตรง {matched} จาก {total} ข้อ",
                    "matched_details": matched_details,
                }
            )

    results.sort(key=lambda r: r["match_percent"], reverse=True)
    if not results:
        return [], None, None

    top_risk = max(
        (r["risk_level"] for r in results), key=lambda lv: RISK_ORDER.get(lv, 0)
    )
    recommendation = DB_ADVICE.get(top_risk, DB_ADVICE["ปกติ"])
    return results, top_risk, recommendation


def build_detect2(ai_res, q10):
    if ai_res == "clot":
        size = {"small": "ขนาดเล็ก", "large": "ขนาดใหญ่"}.get(q10, "")
        return f"ลิ่มเลือด{size}"
    return AI_RESULT_TH.get(ai_res, ai_res)


def _clean(v):
    if isinstance(v, str):
        return v.strip('"').strip("'").strip()
    return v


@analysis_bp.route("/image", methods=["POST"])
@jwt_required()
def analyze_image():
    filepath = None
    res_filepath = None
    start_time = time.time()
    try:
        current_user_id = get_jwt_identity()
        file = request.files.get("image")


    # =====ตรวจสอบการอัปโหลดรูปภาพ=====
        if not file or file.filename == "":
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "A1",
                        "msg": "กรุณาอัปโหลดรูปภาพก่อนทำการวิเคราะห์",
                    }
                ),
                400,
            )
    # =====ตรวจสอบนามสกุลไฟล์=====
        if not allowed_file(file.filename):
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "A2",
                        "msg": "รูปแบบไฟล์ไม่รองรับ กรุณาอัปโหลดไฟล์นามสกุล .jpg, .jpeg หรือ .png",
                    }
                ),
                400,
            )

        # อ่านเนื้อหาไฟล์
        file_content = file.read()

        # =====ตรวจสอบขนาดไฟล์=====
        if len(file_content) > MAX_FILE_SIZE:
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "A3",
                        "msg": "ขนาดไฟล์เกินขีดจำกัด กรุณาอัปโหลดไฟล์ขนาดไม่เกิน 10 MB",
                    }
                ),
                400,
            )
        # ===== SAVE IMAGE =====
        unique_id = uuid.uuid4().hex
        filename = f"user_{current_user_id}_{unique_id}.jpg"
        filepath = os.path.join(UPLOAD_FOLDER, filename)

        with open(filepath, "wb") as f:
            f.write(file_content)
        img_bgr = cv2.imdecode(np.frombuffer(file_content, np.uint8), cv2.IMREAD_COLOR)
        if img_bgr is None:
            return jsonify({"status": "error", "error_code": "A5","msg": "ไฟล์รูปภาพชำรุดหรือไม่สมบูรณ์ กรุณาตรวจสอบไฟล์แล้วอัปโหลดใหม่อีกครั้ง"}), 400

        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        img_resized = cv2.resize(img_rgb, (IMG_SIZE, IMG_SIZE))

        # ===== A4: not menstrual image =====
        hsv = cv2.cvtColor(img_resized, cv2.COLOR_RGB2HSV)

        mask_red = cv2.inRange(
            hsv, np.array([0, 58, 16]), np.array([14, 255, 214])
        ) | cv2.inRange(hsv, np.array([161, 58, 16]), np.array([179, 255, 214]))

        if (np.sum(mask_red > 0) / mask_red.size) < RED_RATIO_LIMIT:
            if os.path.exists(filepath):
                os.remove(filepath)
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "A6",
                        "msg": "ไม่พบลักษณะเลือดประจำเดือนในภาพ กรุณาอัปโหลดภาพที่เกี่ยวข้องลักษณะเลือดประจำเดือน",
                    }
                ),
                400,
            )

        # ===== AI =====
        std_limit = calculate_dynamic_std(img_resized)
        mask, conf, avg_conf = run_inference(img_resized)

        # เรียกใช้ฟังก์ชันใหม่ที่คืนค่าสถานะเป็นชื่อคลาสเลย
        ai_res = validate_ai_findings(mask, conf, img_resized, std_limit)

        img_visual = img_resized.copy()

        class_info = {
            1: {"name": "ลิ่มเลือด", "color": (128, 0, 128)},  # ม่วง
            2: {"name": "เนื้อเยื่อ", "color": (255, 0, 0)},    # แดง
        }
        
        text_to_draw = []
        
        for cls_id, info in class_info.items():
            m = ((mask == cls_id) & (conf > CONF_THRESHOLD)).astype(np.uint8)
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            for c in cnts:
                area = cv2.contourArea(c)
                if area > MIN_AREA:
                    # 1. จำลองหน้ากากเพื่อหาค่า STD ก่อนวาด!
                    m_temp = np.zeros(img_resized.shape[:2], np.uint8)
                    cv2.drawContours(m_temp, [c], -1, 255, -1)
                    std_val = np.std(img_resized[m_temp > 0])

                    # 2. สร้างเงื่อนไข "ต้องสอบผ่านด่าน STD" ถึงจะให้วาดกรอบ
                    is_valid = False
                    if cls_id == 1 and std_val <= std_limit:
                        is_valid = True
                    elif cls_id == 2 :
                        is_valid = True

                    if is_valid:
                        cv2.drawContours(img_visual, [c], -1, info["color"], 3)
                        x, y, w, h = cv2.boundingRect(c)
                        label_y = (y - 30) if cls_id == 2 else (y + h + 10)
                        label_y = max(label_y, 10)
                        
                        text_to_draw.append((x, label_y, info["name"], info["color"]))
                        
        if text_to_draw:
            img_pil = Image.fromarray(img_visual)
            draw = ImageDraw.Draw(img_pil)
            
            try:
                BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                font_path = os.path.join(BASE_DIR, "static", "fonts", "2.3.2 THSarabunNew.ttf")
                font = ImageFont.truetype(font_path, 36) 
            except IOError:
                logger.error(f"don't have {font_path} ")
                font = ImageFont.load_default()

            for (x, y, text, color) in text_to_draw:
                draw.text((x, y), text, font=font, fill=color, stroke_width=1, stroke_fill=color)

            # แปลงภาพกลับเพื่อไปเซฟด้วย OpenCV
            img_visual = np.array(img_pil)

        # ตั้งชื่อไฟล์ใหม่สำหรับภาพที่วาดผลแล้ว
        res_filename = f"res_{filename}"
        res_filepath = os.path.join(UPLOAD_FOLDER, res_filename)

        # เซฟภาพที่วาดเส้นแล้วลงในโฟลเดอร์ uploads
        cv2.imwrite(res_filepath, cv2.cvtColor(img_visual, cv2.COLOR_RGB2BGR))
        base_url = request.host_url.rstrip("/") + "/analysis/"
        return jsonify(
            {
                "status": "success",
                "ai_result": ai_res,
                "image_path": f"{base_url}uploads/{filename}",
                "visual_path": f"{base_url}uploads/{res_filename}",
                "detect_label": AI_RESULT_TH.get(ai_res, ai_res),
                "confidence": round(avg_conf * 100, 2),
                #"processing_time": round(time.time() - start_time, 2),
            }
        )

    except Exception as e:

        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except:
                pass 
        if res_filepath and os.path.exists(res_filepath):
            try:
                os.remove(res_filepath)
            except:
                pass
        logger.error(f"System Error: {e}")
        return jsonify({"status": "error", "error_code":"A10","msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500


@analysis_bp.route("/risk", methods=["POST"])
@jwt_required()
def analyze_risk():
    db = None
    cursor = None
    assessment_id = None
    start_time = time.time()
    
    try:
        current_user_id = get_jwt_identity()
        data = request.form

        ai_res = _clean(data.get("aiResult"))
        image_path = data.get("imagePath")
        confidence_raw = data.get("confidence")
        try:
            confidence = float(confidence_raw) if confidence_raw not in (None, "") else None
        except (TypeError, ValueError):
            confidence = None

        q7_list = [_clean(x) for x in data.getlist("q7")]  # รับค่า q7 เป็น list
        q7_valid = [x for x in q7_list if x]

        answers = {
            "q1": _clean(data.get("q1")),
            "q2": _clean(data.get("q2")),
            "q3": _clean(data.get("q3")),
            "q4": _clean(data.get("q4")),
            "q5": _clean(data.get("q5")),
            "q6": _clean(data.get("q6")),
            "q7": q7_valid,
            "q8": _clean(data.get("q8")),
            "q9": _clean(data.get("q9")),
            "q10": _clean(data.get("q10")),
        }

        errors = validate_answers(answers, ai_res, answers["q8"])
        if errors:
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "A4",
                        "msg": "โปรดระบุข้อมูลอาการให้ครบถ้วน",
                        "errors": errors,
                    },
                ),
                400,
            )
        if answers["q4"] == "postcoital" and answers["q8"] == "no_sex":
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "A7",
                        "msg": "ความสัมพันธ์อาการไม่สอดคล้องกันของลักษณะเลือดออกและประวัติทางเพศ",
                    }
                ),
                400,
         )

        detect1 = AI_RESULT_TH.get(ai_res, ai_res)
        detect2 = build_detect2(ai_res, answers["q10"])

        results, risk_level, recommendation = screen_symptoms(ai_res, answers)

        if not results:
            risk_level = "ไม่พบความเสี่ยงที่ชัดเจน"
            potential_disease = "ไม่พบโรคที่สอดคล้องกับอาการ"
            recommendation = (
                "ระบบไม่พบภาวะหรือโรคที่สอดคล้องกับข้อมูลอาการที่ท่านระบุในฐานข้อมูลปัจจุบัน "
                "เพื่อความถูกต้องและความปลอดภัยของท่าน แนะนำให้เข้ารับคำปรึกษาจากแพทย์ผู้เชี่ยวชาญด้านสูตินรีเวช "
                "เพื่อรับการตรวจวินิจฉัยเพิ่มเติม"
            )
            disease_scores = []
        else:
            potential_disease = ", ".join(r["disease"] for r in results)[:255]
            disease_scores = results

        q7_joined = ",".join(answers["q7"])
        db = get_db_connection()
        cursor = db.cursor()
        cursor.execute(
            """
            INSERT INTO Risk_Assessment
                (UserID, Detect1, Detect2, Confidence,
                 Q1_Flow_Volume, Q2_Duration, Q3_Cycle_Frequency,
                 Q4_Bleeding_Characteristics, Q5_Menstrual_Pain, Q6_Pelvic_Pain,
                 Q7_Associated_Symptoms, Q8_Sexual_History, Q9_Pregnancy_Test,
                 Q10_Clot_Size, Potential_Disease, Risk_Level, Recommendation, Image_Path)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                current_user_id,
                detect1,
                detect2,
                confidence,
                answers["q1"],
                answers["q2"],
                answers["q3"],
                answers["q4"],
                answers["q5"],
                answers["q6"],
                q7_joined,
                answers["q8"],
                answers["q9"],
                answers["q10"],
                potential_disease,
                risk_level,
                recommendation,
                image_path,
            ),
        )
        db.commit()
        assessment_id = cursor.lastrowid

    
        response_error_code = "A7" if not results else None

        return (
            jsonify(
                {
                    "status": "success",
                    "error_code": response_error_code,
                    "assessment_id": assessment_id,
                    "msg": "ไม่พบโรคที่สอดคล้องกับอาการที่ระบุ",
                    "data": {
                        "detect1": detect1,
                        "detect2": detect2,
                        "confidence": confidence,
                        "potential_disease": potential_disease,
                        "risk_level": risk_level,
                        "recommendation": recommendation,
                        "disease_scores": disease_scores,
                    },
                }
            ),
            201,
        )
    except mysql.connector.Error as err:
        if db is not None:
            db.rollback()
        logger.error(f"Database Error: {err}")
        return jsonify({"status": "error", "error_code": "A9", "msg": "บันทึกผลวิเคราะห์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"}), 500
        
    except Exception as e:
        logger.error(f"System Error: {e}")
        return jsonify({"status": "error", "error_code": "A10", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
        
    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()

    
@analysis_bp.route("/result/<int:assessment_id>", methods=["GET"])
@jwt_required()
def get_assessment_result(assessment_id):
    current_user_id = get_jwt_identity()
    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT AssessmentID, Detect1, Detect2, Confidence, 
                   Potential_Disease, Risk_Level, Recommendation, Image_Path
            FROM Risk_Assessment
            WHERE AssessmentID = %s AND UserID = %s
            """,
            (assessment_id, current_user_id),
        )
        row = cursor.fetchone()

        if not row:
            return (
                jsonify(
                    {
                        "status": "error",
                        "msg": "ไม่พบข้อมูลการประเมินนี้",
                    }
                ),
                404,
            )

        return jsonify({"status": "success", "data": row}), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error: {err}")
        return jsonify({"status" : "errpr","error_code":"A11", "msg": "ไม่สามารถดูผลวิเคราะห์ กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        logger.error(f"System Error: {e}")
        return jsonify({"status": "error", "error_code":"A10","msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()
# ==============================
# 🛡️ API สำหรับขอดูรูป 
# ==============================
@analysis_bp.route("/uploads/<filename>", methods=["GET"])
@jwt_required()
def get_secure_image(filename):
    try:
        current_user_id = str(get_jwt_identity())
        safe_filename = os.path.basename(filename)
    
        if not safe_filename.startswith(f"user_{current_user_id}_") and not safe_filename.startswith(f"res_user_{current_user_id}_"):
            return jsonify({"status": "error", "msg": "คุณไม่มีสิทธิ์เข้าถึงรูปภาพนี้"}), 403

        return send_from_directory(UPLOAD_FOLDER, safe_filename)
        
    except Exception as e:
        logger.error(f"Image Access Error: {e}")
        return jsonify({"status": "error", "msg": "ไม่พบไฟล์รูปภาพ"}), 404