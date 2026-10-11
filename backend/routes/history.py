from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from config.database import get_db_connection
import mysql.connector
import logging
import os 

history_bp = Blueprint("history", __name__)
logger = logging.getLogger(__name__)

# กำหนด Path ของโฟลเดอร์รูปภาพ
UPLOAD_FOLDER = os.path.join(os.getcwd(), "uploads")
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:5000")

# ---------------------------------------------------------
# Helper: แปลงชื่อไฟล์ให้เป็น URL เต็มๆ 
# ---------------------------------------------------------
def format_history_images(record):
    if record and record.get("Image_Path"):
        image_path = record["Image_Path"]
        filename = image_path.split("/")[-1]
        record["Image_Path"] = f"{SERVER_URL}/analysis/secure-image/{filename}"
        record["Res_Image_Path"] = f"{SERVER_URL}/analysis/secure-image/res_{filename}"
        
    return record

# ---------------------------------------------------------
# 1. GET: ดึงรายการประวัติทั้งหมด 
# ---------------------------------------------------------
@history_bp.route("/", methods=["GET"])
@jwt_required()
def get_history_list():
    current_user_id = get_jwt_identity()
    db = get_db_connection()
    cursor = None

    if not db:
        logger.error(f"Database connection failed at GET /history (UserID: {current_user_id})")
        return jsonify({"status": "error", "error_code": "H2","msg": "เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500

    try:
        cursor = db.cursor(dictionary=True)
        query = """
            SELECT AssessmentID, Detect2, Risk_Level, Potential_Disease, 
                   Image_Path, Create_At 
            FROM Risk_Assessment 
            WHERE UserID = %s 
            ORDER BY Create_At DESC
        """
        cursor.execute(query, (current_user_id,))
        history = cursor.fetchall()

        if not history:
            return jsonify({"status": "empty","error_code":"H1", "msg": "ไม่พบประวัติการใช้งาน"}), 200

        # [เพิ่ม] แปลง URL รูปภาพก่อนส่งให้หน้าบ้าน
        history = [format_history_images(h) for h in history]

        return jsonify({"status": "success", "data": history}), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error fetching history list (UserID: {current_user_id}): {err}")
        return jsonify({"status": "error", "error_code": "H2","msg": "เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        logger.error(f"System Error fetching history list (UserID: {current_user_id}): {e}")
        return jsonify({"status": "error", "error_code": "H4", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()

# ---------------------------------------------------------
# 2. GET: ดูรายละเอียดฉบับเต็ม 
# ---------------------------------------------------------
@history_bp.route("/<int:assessment_id>", methods=["GET"])
@jwt_required()
def get_history_detail(assessment_id):
    current_user_id = get_jwt_identity()
    db = get_db_connection()
    cursor = None

    if not db:
        logger.error(f"Database connection failed at GET /history/{assessment_id} (UserID: {current_user_id})")
        return jsonify({"status": "error", "error_code": "H2","msg": "เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500

    try:
        cursor = db.cursor(dictionary=True)
        query = "SELECT * FROM Risk_Assessment WHERE AssessmentID = %s AND UserID = %s"
        cursor.execute(query, (assessment_id, current_user_id))
        detail = cursor.fetchone()

        if not detail:
            return jsonify({"status": "error", "error_code": "H1", "msg": "ไม่พบข้อมูลประวัติการใช้งาน"}), 404

        # [เพิ่ม] แปลง URL รูปภาพก่อนส่งให้หน้าบ้าน
        detail = format_history_images(detail)

        return jsonify({"status": "success", "data": detail}), 200
        
    except mysql.connector.Error as err:
        logger.error(f"Database Error fetching history detail (ID: {assessment_id}): {err}")
        return jsonify({"status": "error","error_code":"H2", "msg": "เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        logger.error(f"System Error fetching history detail (ID: {assessment_id}): {e}")
        # ลบ \ ที่เกินมาออกให้แล้วครับ
        return jsonify({"status": "error", "error_code": "H4", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()

# ---------------------------------------------------------
# 3. DELETE: ลบประวัติ 
# ---------------------------------------------------------
@history_bp.route("/<int:assessment_id>", methods=["DELETE"])
@jwt_required()
def delete_history(assessment_id):
    current_user_id = get_jwt_identity()
    db = get_db_connection()
    cursor = None

    if not db:
        logger.error(f"Database connection failed at DELETE /history/{assessment_id} (UserID: {current_user_id})")
        return jsonify({"status": "error","error_code":"H3","msg": "เกิดข้อผิดพลาดในการลบข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500

    try:
        cursor = db.cursor(dictionary=True) 
        
        find_query = "SELECT Image_Path FROM Risk_Assessment WHERE AssessmentID = %s AND UserID = %s"
        cursor.execute(find_query, (assessment_id, current_user_id))
        record = cursor.fetchone()

        if not record:
            return jsonify({"status": "error", "error_code": "H1", "msg": "ไม่พบข้อมูลประวัติการใช้งาน"}), 404

        # 2. ลบข้อมูลจากฐานข้อมูล
        delete_query = "DELETE FROM Risk_Assessment WHERE AssessmentID = %s AND UserID = %s"
        cursor.execute(delete_query, (assessment_id, current_user_id))
        db.commit()

        # ลบรูปภาพจากเซิร์ฟเวอร์
        image_url = record.get("Image_Path")
        if image_url:
            filename = image_url.split("/")[-1]
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception as e:
                    logger.warning(f"ลบไฟล์รูปภาพต้นฉบับไม่สำเร็จ (ID: {assessment_id}): {e}")

            res_filepath = os.path.join(UPLOAD_FOLDER, f"res_{filename}")
            if os.path.exists(res_filepath):
                try:
                    os.remove(res_filepath)
                except Exception as e:
                    logger.warning(f"ลบไฟล์รูปภาพประมวลผลไม่สำเร็จ (ID: {assessment_id}): {e}")

        return jsonify({"status": "success", "msg": "ลบข้อมูลประวัติการใช้งานเรียบร้อยแล้ว"}), 200

    except mysql.connector.Error as err:
        db.rollback() 
        logger.error(f"Database Error deleting history (ID: {assessment_id}): {err}")
        return jsonify({"status": "error","error_code":"H3", "msg": "เกิดข้อผิดพลาดในการลบข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        db.rollback()
        logger.error(f"System Error deleting history (ID: {assessment_id}): {e}")
        return jsonify({"status": "error","error_code":"H4", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()