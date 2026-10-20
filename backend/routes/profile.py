import logging
import os
import time
from datetime import date, datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
import mysql.connector
from werkzeug.utils import secure_filename

from config.database import get_db_connection
from extensions import bcrypt

profile_bp = Blueprint("profile", __name__)
logger = logging.getLogger(__name__)

# กำหนดโฟลเดอร์สำหรับเก็บไฟล์รูปโปรไฟล์
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE_UPLOAD_FOLDER = os.path.join(
    BASE_DIR, "static", "uploads", "profiles"
)
os.makedirs(PROFILE_UPLOAD_FOLDER, exist_ok=True)
MAIN_UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:5000")
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def clean_input(val):
    return val.strip('"').strip("'") if val is not None else None


# ---------------------------------------------------------
# 1. GET: ดูข้อมูลโปรไฟล์
# ---------------------------------------------------------
@profile_bp.route("/", methods=["GET"])
@jwt_required()
def get_profile():
    user_id = get_jwt_identity()
    db = get_db_connection()
    cursor = None

    if not db:
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P9",
                    "msg": "เกิดข้อผิดพลาดในการบันทึกข้อมูล "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    try:
        cursor = db.cursor(dictionary=True)

        sql = """
            SELECT Username, Name, LastName, Birthday, Email, Profile_Image
            FROM User
            WHERE UserID = %s
        """
        cursor.execute(sql, (user_id,))
        user = cursor.fetchone()

        if user:
            if user.get("Birthday"):
                user["Birthday"] = user["Birthday"].strftime("%Y-%m-%d")
            if user.get("Profile_Image"):
                user["Profile_Image"] = (
                    f"{SERVER_URL}/static/uploads/profiles/"
                    f"{user['Profile_Image']}"
                )
            return jsonify({"status": "success", "data": user}), 200

        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P11",
                    "msg": "ไม่พบข้อมูลผู้ใช้",
                }
            ),
            404,
        )

    except mysql.connector.Error as err:
        logger.error(f"Database Error fetching profile: {err}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P9",
                    "msg": "เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    except Exception as e:
        logger.error(f"System Error fetching profile: {e}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P10",
                    "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


# ---------------------------------------------------------
# 2. POST/PUT: แก้ไขข้อมูลและรูปภาพ
# ---------------------------------------------------------
@profile_bp.route("/update", methods=["POST"])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    db = get_db_connection()
    cursor = None

    if not db:
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P9",
                    "msg": "เกิดข้อผิดพลาดในการบันทึกข้อมูล "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    username = clean_input(request.form.get("username"))
    firstName = clean_input(request.form.get("firstName"))
    lastName = clean_input(request.form.get("lastName"))
    birthDate = clean_input(request.form.get("birthDate"))
    file = request.files.get("profileImg")

    # เช็กค่าว่าง
    if not username or not firstName or not lastName or not birthDate:
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P5",
                    "msg": "กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วนก่อนทำการบันทึก",
                }
            ),
            400,
        )

    try:
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            "SELECT UserID FROM User WHERE Username = %s AND UserID != %s",
            (username, user_id),
        )
        if cursor.fetchone():
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "P1",
                        "msg": "ชื่อผู้ใช้งานนี้มีผู้ใช้แล้ว",
                    }
                ),
                400,
            )

        if len(username) > 32:
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "P7",
                        "msg": "ชื่อผู้ใช้งานต้องมีความยาวไม่เกิน 32 ตัวอักษร",
                    }
                ),
                400,
            )

        if " " in username:
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "P6",
                        "msg": "ห้ามมีช่องว่างระหว่างชื่อผู้ใช้งาน",
                    }
                ),
                400,
            )

        try:
            birthday_obj = datetime.strptime(
                birthDate, "%Y-%m-%d"
            ).date()
            if birthday_obj.year > 2400:
                birthday_obj = birthday_obj.replace(
                    year=birthday_obj.year - 543
                )
            today = date.today()
            age = (
                today.year
                - birthday_obj.year
                - (
                    (today.month, today.day)
                    < (birthday_obj.month, birthday_obj.day)
                )
            )
            if age < 13:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "error_code": "P8",
                            "msg": "ผู้ใช้งานต้องมีอายุตั้งแต่ 13 ปีขึ้นไป",
                        }
                    ),
                    400,
                )
        except ValueError:
            return (
                jsonify(
                    {"status": "error", "msg": "รูปแบบวันที่ไม่ถูกต้อง"}
                ),
                400,
            )

        profile_img_name = None
        if file and file.filename != "":
            if not allowed_file(file.filename):
                return (
                    jsonify(
                        {
                            "status": "error",
                            "error_code": "P3",
                            "msg": "รูปแบบไฟล์ไม่รองรับ "
                            "กรุณาอัปโหลดไฟล์นามสกุล .jpg, .jpeg หรือ .png",
                        }
                    ),
                    400,
                )

            file.seek(0, os.SEEK_END)
            file_length = file.tell()
            if file_length > MAX_FILE_SIZE:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "error_code": "P4",
                            "msg": "ขนาดไฟล์เกินขีดจำกัด "
                            "กรุณาอัปโหลดไฟล์ขนาดไม่เกิน 10 MB",
                        }
                    ),
                    400,
                )

            # บันทึกไฟล์รูปลงระบบ
            file.seek(0)
            original_filename = secure_filename(file.filename)
            file_ext = (
                original_filename.rsplit(".", 1)[1].lower()
                if "." in original_filename
                else "png"
            )
            profile_img_name = (
                f"profile_{user_id}_{int(time.time())}.{file_ext}"
            )
            save_path = os.path.join(
                PROFILE_UPLOAD_FOLDER, profile_img_name
            )
            file.save(save_path)

        # ดึงชื่อรูปโปรไฟล์ "เก่า" มาเก็บไว้ก่อน เผื่อต้องลบทิ้ง
        old_profile_image = None
        if profile_img_name:
            cursor.execute(
                "SELECT Profile_Image FROM User WHERE UserID = %s",
                (user_id,),
            )
            user_record = cursor.fetchone()
            if user_record and user_record.get("Profile_Image"):
                old_profile_image = user_record["Profile_Image"]

        # Map ข้อมูลเพื่อเตรียม Update ลงฐานข้อมูล
        updates = []
        params = []
        if username is not None:
            updates.append("Username=%s")
            params.append(username)
        if firstName is not None:
            updates.append("Name=%s")
            params.append(firstName)
        if lastName is not None:
            updates.append("LastName=%s")
            params.append(lastName)
        if birthDate is not None:
            updates.append("Birthday=%s")
            params.append(birthday_obj)
        if profile_img_name:
            updates.append("Profile_Image=%s")
            params.append(profile_img_name)

        params.append(user_id)
        sql = f"UPDATE User SET {', '.join(updates)} WHERE UserID=%s"
        cursor.execute(sql, params)
        db.commit()

        # ลบรูปโปรไฟล์เก่าทิ้ง
        if old_profile_image:
            old_image_path = os.path.join(
                PROFILE_UPLOAD_FOLDER, old_profile_image
            )
            if os.path.exists(old_image_path):
                try:
                    os.remove(old_image_path)
                except Exception as e:
                    logger.warning(
                        f"ลบรูปโปรไฟล์เก่าไม่สำเร็จ: {e}"
                    )

        return (
            jsonify({"status": "success", "msg": "บันทึกข้อมูลสำเร็จ"}),
            200,
        )

    except mysql.connector.Error as err:
        db.rollback()
        logger.error(f"Database Error updating profile: {err}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P9",
                    "msg": "เกิดข้อผิดพลาดในการบันทึกข้อมูล "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    except Exception as e:
        if db:
            db.rollback()
        logger.error(f"System Error updating profile: {e}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "P10",
                    "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


# ---------------------------------------------------------
# 3. DELETE: ลบบัญชีผู้ใช้งาน
# ---------------------------------------------------------
@profile_bp.route("/delete", methods=["DELETE"])
@jwt_required()
def delete_account():
    user_id = get_jwt_identity()
    claims = get_jwt()
    jti = claims["jti"]
    exp_timestamp = claims["exp"]

    data = request.get_json(silent=True) or {}
    password = data.get("password")

    if not password:
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "D3",
                    "msg": "กรุณากรอกรหัสผ่านเพื่อยืนยันการลบบัญชี",
                }
            ),
            400,
        )

    db = get_db_connection()
    cursor = None

    if not db:
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "D4",
                    "msg": "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    try:
        cursor = db.cursor(dictionary=True)

        # 1. เช็ครหัสผ่านก่อนว่าตรงกับในฐานข้อมูลไหม
        cursor.execute(
            "SELECT Password, Profile_Image FROM User WHERE UserID = %s",
            (user_id,),
        )
        user = cursor.fetchone()

        if not user or not bcrypt.check_password_hash(
            user["Password"], password
        ):
            return (
                jsonify(
                    {
                        "status": "error",
                        "error_code": "D1",
                        "msg": "รหัสผ่านไม่ถูกต้อง",
                    }
                ),
                401,
            )

        profile_img = user.get("Profile_Image")

        # 1.1 ดึงรายชื่อรูปภาพประวัติการวิเคราะห์ทั้งหมดของผู้ใช้คนนี้ออกมา
        cursor.execute(
            "SELECT Image_Path FROM Risk_Assessment WHERE UserID = %s",
            (user_id,),
        )
        assessment_records = cursor.fetchall()
        logger.info(
            f"เจอประวัติการวิเคราะห์ทั้งหมด: {len(assessment_records)} รายการ"
        )

        # 2. ถ้ารหัสถูก ค่อยทำการลบข้อมูลใน Database
        cursor.execute(
            "INSERT INTO TokenBlacklist (JTI, UserID, ExpiresAt_TK) "
            "VALUES (%s, %s, FROM_UNIXTIME(%s))",
            (jti, user_id, exp_timestamp),
        )

        cursor.execute(
            "DELETE FROM Risk_Assessment WHERE UserID = %s", (user_id,)
        )
        cursor.execute(
            "DELETE FROM User WHERE UserID = %s", (user_id,)
        )
        cursor.execute(
            "DELETE FROM TokenBlacklist WHERE ExpiresAt_TK < NOW()"
        )

        db.commit()

        # 3. จัดการลบไฟล์รูปภาพทั้งหมดทิ้งออกจากเครื่อง
        if profile_img and "default" not in profile_img.lower():
            clean_profile_name = os.path.basename(
                profile_img.replace("\\", "/")
            )
            img_path = os.path.join(
                PROFILE_UPLOAD_FOLDER, clean_profile_name
            )
            if os.path.exists(img_path):
                try:
                    os.remove(img_path)
                except Exception as e:
                    logger.warning(
                        f"ลบรูปโปรไฟล์ไม่สำเร็จตอนลบบัญชี: {e}"
                    )

        for record in assessment_records:
            history_img = record.get("Image_Path")
            if history_img:
                clean_path = history_img.replace("\\", "/")
                filename_only = os.path.basename(clean_path)

                if filename_only.startswith("res_"):
                    res_filename = filename_only
                    orig_filename = filename_only[4:]
                else:
                    orig_filename = filename_only
                    res_filename = f"res_{filename_only}"

                orig_path = os.path.join(
                    MAIN_UPLOAD_FOLDER, orig_filename
                )
                res_path = os.path.join(
                    MAIN_UPLOAD_FOLDER, res_filename
                )

                for path in [orig_path, res_path]:
                    if os.path.exists(path):
                        try:
                            os.remove(path)
                        except Exception as e:
                            logger.warning(f"ลบไฟล์ไม่สำเร็จ: {e}")
                    else:
                        logger.debug(f"หาไฟล์ไม่เจอในพาธนี้: {path}")

        return (
            jsonify(
                {
                    "status": "success",
                    "msg": "ลบบัญชีผู้ใช้งานและข้อมูลทั้งหมดเรียบร้อยแล้ว",
                }
            ),
            200,
        )

    except mysql.connector.Error as err:
        db.rollback()
        logger.error(f"Database Error deleting account: {err}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "D4",
                    "msg": "เกิดข้อผิดพลาดในการลบบัญชี กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )
    except Exception as e:
        db.rollback()
        logger.error(f"System Error deleting account: {e}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "D5",
                    "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )
    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


# ---------------------------------------------------------
# 4. POST: ออกจากระบบ
# ---------------------------------------------------------
@profile_bp.route("/logout", methods=["POST"])
@jwt_required()
def logout():
    claims = get_jwt()
    jti = claims["jti"]
    exp_timestamp = claims["exp"]
    user_id = get_jwt_identity()

    db = get_db_connection()
    cursor = None

    if not db:
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "L2",
                    "msg": "เกิดข้อผิดพลาดในการออกจากระบบ "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )

    try:
        cursor = db.cursor()

        cursor.execute(
            "INSERT INTO TokenBlacklist (JTI, UserID, ExpiresAt_TK) "
            "VALUES (%s, %s, FROM_UNIXTIME(%s))",
            (jti, user_id, exp_timestamp),
        )

        cursor.execute(
            "DELETE FROM TokenBlacklist WHERE ExpiresAt_TK < NOW()"
        )
        db.commit()
        return (
            jsonify(
                {"status": "success", "msg": "ออกจากระบบเรียบร้อยแล้ว"}
            ),
            200,
        )

    except mysql.connector.Error as err:
        db.rollback()
        logger.error(f"Database Error during logout: {err}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "L2",
                    "msg": "เกิดข้อผิดพลาดในการออกจากระบบ "
                    "กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )
    except Exception as e:
        db.rollback()
        logger.error(f"System Error during logout: {e}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error_code": "L3",
                    "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง",
                }
            ),
            500,
        )
    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()
