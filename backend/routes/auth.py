import email
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from datetime import datetime, date
from extensions import bcrypt
from numpy import rint
from config.database import get_db_connection
import mysql.connector
import random
import smtplib
import os
from email.mime.text import MIMEText
import re
from datetime import datetime, timedelta
from dotenv import load_dotenv
import logging

auth_bp = Blueprint("auth_bp", __name__)
logger = logging.getLogger(__name__)
# ==========================================
# ระบบสมาชิก 
# ==========================================
@auth_bp.route("/register", methods=["POST"])
def register():
    db = None    
    cursor = None
    
    try:           
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        confirm_pw = str(data.get("confirmPassword", ""))
        name = str(data.get("firstName", "")).strip()
        lastname = str(data.get("lastName", "")).strip()
        birthday = str(data.get("birthDate", "")).strip()
        email = str(data.get("email", "")).strip()
        consent = data.get("isConsent")

        if not consent:
            return jsonify({"status":"error","error_code":"R11","msg": "กรุณากดยอมรับเงื่อนไขและนโยบายความเป็นส่วนตัวก่อนดำเนินการต่อ"}), 400

        # ---ตรวจสอบข้อมูลว่าง---
        if not all([username, password, confirm_pw, name, lastname, birthday, email]):
            return jsonify({"status":"error","error_code":"R2","msg": "กรุณากรอกข้อมูลให้ครบถ้วน"}), 400

        # ---ตรวจสอบความยาวรหัสผ่าน---
        if len(password) < 8:
            return jsonify({"status":"error","error_code":"R3","msg": "รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร"}), 400
        if len(username)> 32:
            return jsonify({"status":"error","error_code":"R8","msg": "ชื่อผู้ใช้งานต้องมีความยาวไม่เกิน 32 ตัวอักษร"}), 400
        if " " in username:
            return jsonify({"status":"error","error_code":"R10","msg": "ห้ามมีช่องว่างระหว่างชื่อผู้ใช้งาน"}), 400
        if len(password) >128:
            return jsonify({"status":"error","error_code":"R9","msg": "รหัสผ่านต้องมีความยาวไม่เกิน 128 ตัวอักษร"}), 400
        password_pattern = r"^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).+$"
        if not re.match(password_pattern, password):
            return jsonify({"status":"error","error_code":"R12","msg": "รหัสผ่านต้องประกอบด้วยตัวอักษรพิมพ์ใหญ่ อักษรพิมพ์เล็ก และอักษรพิเศษอย่างน้อย 1 ตัว"}), 400
        # ---ตรวจสอบรหัสผ่านตรงกัน---
        if password != confirm_pw:
            return jsonify({"status":"error","error_code":"R4","msg": "โปรดระบุรหัสผ่านทั้งสองช่องให้ตรงกัน"}), 400

        # ---ตรวจสอบรูปแบบอีเมล---
        email_pattern = r"^[\w\.-]+@[\w\.-]+\.\w+$"
        if not re.match(email_pattern, email):
            return jsonify({"status":"error","error_code":"R6","msg": "โปรดระบุอีเมลที่ถูกต้อง"}), 400
            
        # ---ตรวจสอบเงื่อนไขอายุ---
        try:
            birthday_obj = datetime.strptime(birthday, "%Y-%m-%d").date()
            if birthday_obj.year > 2400:
                birthday_obj = birthday_obj.replace(year=birthday_obj.year - 543)
            today = date.today()
            age = today.year - birthday_obj.year - ((today.month, today.day) < (birthday_obj.month, birthday_obj.day))
            if age < 13:
                return jsonify({"status":"error","error_code":"R5","msg": "ผู้สมัครต้องมีอายุตั้งแต่ 13 ปีขึ้นไปจึงจะใช้งานได้"}), 400
        except ValueError:
            return jsonify({"status":"error","msg": "รูปแบบวันที่ไม่ถูกต้อง"}), 400

        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        # ตรวจสอบ Username ซ้ำ
        check_sql = "SELECT Username FROM User WHERE Username = %s"
        cursor.execute(check_sql, (username,))
        if cursor.fetchone():
            return jsonify({"status":"error","error_code":"R1","msg": "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว"}), 400

        # ตรวจสอบ email ซ้ำ
        check_sql = "SELECT Email FROM User WHERE Email = %s"
        cursor.execute(check_sql, (email,))
        if cursor.fetchone():
            return jsonify({"status":"error","error_code":"R7","msg": "อีเมลนี้ถูกใช้แล้ว กรุณาระบุอีเมลใหม่"}), 400
        hashed_pw = bcrypt.generate_password_hash(password).decode("utf-8")
        consent_value = 1 if consent else 0

            # บันทึกข้อมูล
        sql = "INSERT INTO User (Username, Password, Name, LastName, Birthday, Email, Is_Consent) VALUES (%s, %s, %s, %s, %s, %s, %s)"
        values = (username, hashed_pw, name, lastname, birthday_obj, email, consent_value)

        cursor.execute(sql, values)
        db.commit()  
        return jsonify({"msg": "สมัครสมาชิกสำเร็จ"}), 201

    except mysql.connector.Error as err:
        logger.error(f"Database Error: {err}")
        return jsonify({"status": "error","error_code":"R13","msg": "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500

    except Exception as e:
        logger.error(f"System Error: {e}")
        return jsonify({"status": "error","error_code":"R14","msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
        
    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()

# ==========================================
# 🔑 เข้าสู่ระบบ (Login) 
# ==========================================
@auth_bp.route("/login", methods=["POST"])
def login():
    db = None
    cursor = None

    try:
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))

        if not username or not password:
            return jsonify({
                "status": "error",
                "error_code": "A2",
                "msg": "กรุณากรอกข้อมูลให้ครบถ้วน"
            }), 400

        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        # ค้นหาผู้ใช้จากชื่อผู้ใช้
        sql = "SELECT * FROM User WHERE Username = %s"
        cursor.execute(sql, (username,))
        user = cursor.fetchone()
        
        if not user or not bcrypt.check_password_hash(
            user["Password"], password
        ):
            return jsonify({
                "status": "error",
                "error_code": "L1",
                "msg": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            }), 401

        # เข้าสู่ระบบสำเร็จ
        access_token = create_access_token(
            identity=str(user["UserID"])
        )

        return jsonify({
            "access_token": access_token,
            "user": {
                "id": user["UserID"],
                "firstName": user["Name"],
                "lastName": user["LastName"],
            },
        }), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error: {err}")
        return jsonify({
            "status": "error",
            "error_code": "L4",
            "msg": "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กรุณาลองใหม่อีกครั้ง"
        }), 500

    except Exception as e:
        logger.error(f"System Error: {e}")
        return jsonify({
            "status": "error",
            "error_code": "L5",
            "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# --- Configuration (ระบบส่งเมล) ---
GMAIL_USER1 = os.environ.get("GMAIL_USER1")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")

# ==========================================
# 🔑 Forgot Password
# ==========================================
@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    db = None
    cursor = None

    generic_response = {
        "status": "success",
        
        "msg": (
            "หากอีเมลนี้ลงทะเบียนไว้ คุณจะได้รับรหัส OTP "
            "สำหรับรีเซ็ตรหัสผ่านทางอีเมล กรุณาตรวจสอบอีเมลของคุณ"
        )
    }

    try:
        data = request.get_json(silent=True) or {}
        email = str(data.get("email") or "").strip()

        # ตรวจสอบว่ากรอกอีเมลหรือไม่
        if not email:
            return jsonify({
                "status": "error",
                "error_code": "O9",
                "msg": "กรุณากรอกอีเมล"
            }), 400

        db = get_db_connection()

        if not db:
            logger.error("Forgot Password: Database connection failed")
            return jsonify({
                "status": "error",
                "error_code": "O11",
                "msg": "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กรุณาลองใหม่อีกครั้ง"
            }), 500

        cursor = db.cursor(dictionary=True, buffered=True)

        # ค้นหาอีเมลในระบบ
        cursor.execute(
            "SELECT UserID FROM User WHERE Email = %s",
            (email,)
        )
        user = cursor.fetchone()
        if not user:
            return jsonify(generic_response), 200

        import secrets

        otp = f"{secrets.randbelow(900000) + 100000}"
        expire_time = datetime.now() + timedelta(minutes=5)

        # บันทึก OTP และเวลาหมดอายุ
        cursor.execute(
            """
            UPDATE User
            SET ResetOTP = %s, OTPExpireTime = %s
            WHERE UserID = %s
            """,
            (otp, expire_time, user["UserID"])
        )
        db.commit()

        # เตรียมอีเมล OTP
        subject = "Luna Day - Password Reset Verification Code"

        body = f"""
เรียน ผู้ใช้งาน Luna Day

มีการร้องขอให้รีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ

รหัส OTP สำหรับยืนยันตัวตนคือ: {otp}

- รหัสนี้มีอายุการใช้งาน 5 นาที
- โปรดใช้รหัสนี้เพื่อดำเนินการเปลี่ยนรหัสผ่าน
- ห้ามเปิดเผยรหัส OTP แก่บุคคลอื่น

หากคุณไม่ได้เป็นผู้ร้องขอ โปรดละเว้นอีเมลฉบับนี้

ขอแสดงความนับถือ
Luna Day Team
"""

        msg = MIMEText(body, _charset="utf-8")
        msg["Subject"] = subject
        msg["From"] = f"Luna Day Team <{GMAIL_USER1}>"
        msg["To"] = email

        # ส่งอีเมล OTP
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_USER1, GMAIL_APP_PASSWORD)
            server.sendmail(
                GMAIL_USER1,
                email,
                msg.as_string()
            )

        # กรณีส่งอีเมลสำเร็จ
        return jsonify(generic_response), 200

    except mysql.connector.Error:
        if db is not None:
            db.rollback()

        logger.exception("Forgot Password: Database error")

        return jsonify({
            "status": "error",
            "error_code": "O11",
            "msg": "ระบบแจ้งเตือน “เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กรุณาลองใหม่อีกครั้ง"
        }), 500

    except smtplib.SMTPException:
        logger.exception("Forgot Password: Email delivery error")

        return jsonify({
            "status": "error",
            "error_code": "O13",
            "msg": "เกิดปัญหาในการส่งอีเมล กรุณาลองใหม่อีกครั้งภายหลัง"
        }), 500

    except Exception:
        logger.exception("Forgot Password: Unexpected error")

        return jsonify({
            "status": "error",
            "error_code": "O12",
            "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()

        if db is not None:
            db.close()
            
# ==========================================
# 🛡️ verify otp
# ==========================================
@auth_bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    db = None
    cursor = None
    try: 
        data = request.get_json(silent=True) or {}
        email = str(data.get("email") or "").strip()
        otp = str(data.get("otp") or "").strip()

        if not email:
            return jsonify({"status": "error", "error_code": "O9", "msg": "กรุณากรอกอีเมล"}), 400

        if not otp:
            return jsonify({"status": "error", "error_code": "O10", "msg": "กรุณากรอกรหัส OTP ให้ครบถ้วน"}), 400
        db = get_db_connection()
        cursor = db.cursor(dictionary=True, buffered=True)
        cursor.execute(
            """
            SELECT UserID, OTPExpireTime 
            FROM User 
            WHERE Email = %s AND ResetOTP = %s
            """,
            (email, otp),
        )
        user = cursor.fetchone()
        if not user:
            return jsonify({"status":"error","error_code":"O2","msg": "รหัส OTP ไม่ถูกต้อง โปรดตรวจสอบอีกครั้ง"}), 400

        # เช็ควันหมดอายุ
        if user["OTPExpireTime"] is None or datetime.now() > user["OTPExpireTime"]:
            return jsonify({"status":"error","error_code":"A3","msg": "รหัส OTP หมดอายุแล้ว โปรดขอรหัสใหม่"}), 400

        return jsonify({"status":"success","msg": "รหัส OTP ถูกต้อง"}), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error: {err}")
        return jsonify({"status": "error","error_code": "O11","msg": "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500

    except Exception as e:
        logger.error(f"System Error: {e}")
        return jsonify({"status": "error","error_code": "O12","msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()
            
# ==========================================
# 🛡️ Reset Password 
# ==========================================
@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    db = None
    cursor = None
    try: 
        data = request.get_json(silent=True) or {}
        email = str(data.get("email") or "").strip()
        otp = str(data.get("otp") or "").strip()
        new_password = str(data.get("newPassword", ""))
        confirm_password = str(data.get("confirmPassword", ""))

        # เช็คค่าว่าง
        if not all([email, otp, new_password, confirm_password]):
            return jsonify({"status":"error","error_code":"O8","msg": "กรุณากรอกข้อมูลให้ครบถ้วน"}), 400

        # เช็ครหัสผ่านตรงกัน
        if new_password != confirm_password:
            return jsonify({"status":"error","error_code":"O4","msg": "รหัสผ่านไม่ตรงกัน"}), 400

        # เช็คความยาว
        if len(new_password) < 8 :
            return jsonify({"status":"error","error_code":"O5","msg": "รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร"}), 400
        
        if len(new_password) > 128 :
            return jsonify({"status":"error","error_code":"O7","msg": "รหัสผ่านต้องมีความยาวไม่เกิน 128 ตัวอักษร"}), 400
        
        password_pattern = r"^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).+$"
        if not re.match(password_pattern, new_password):
            return jsonify({"status":"error","error_code":"O6","msg": "รหัสผ่านต้องประกอบด้วยตัวอักษรพิมพ์ใหญ่ อักษรพิมพ์เล็ก และอักษรพิเศษอย่างน้อย 1 ตัว"}), 400
        
        db = get_db_connection()
        cursor = db.cursor(dictionary=True, buffered=True)

        #  ดึง OTP + เวลา expire 
        cursor.execute(
            """
            SELECT UserID, OTPExpireTime 
            FROM User 
            WHERE Email = %s AND ResetOTP = %s
            """,
            (email, otp),
        )
        user = cursor.fetchone()

        if not user:
            return jsonify({"status": "error","error_code":"O2","msg": "รหัส OTP ไม่ถูกต้อง โปรดตรวจสอบอีกครั้ง"}), 400

        # เช็ควันหมดอายุซ้ำ
        if user["OTPExpireTime"] is None or datetime.now() > user["OTPExpireTime"]:
            return jsonify({"status": "error", "error_code":"O3","msg": "รหัส OTP หมดอายุแล้ว โปรดขอรหัสใหม่"}), 400

        # แฮชรหัสผ่านใหม่
        hashed_pw = bcrypt.generate_password_hash(new_password).decode("utf-8")

        #  อัปเดตรหัสผ่าน และเคลียร์ค่า OTP ทิ้ง
        cursor.execute(
            """
            UPDATE User 
            SET Password = %s, ResetOTP = NULL, OTPExpireTime = NULL
            WHERE Email = %s
            """,
            (hashed_pw, email),
        )
        db.commit()
        return jsonify({"status": "success","msg": "เปลี่ยนรหัสผ่านสำเร็จ"}), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error: {err}")
        return jsonify({"status": "error","error_code": "O11","msg": "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กรุณาลองใหม่อีกครั้ง"}), 500

    except Exception as e:
        logger.error(f"System Error: {e}")
        return jsonify({"status": "error","error_code": "O12","msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()