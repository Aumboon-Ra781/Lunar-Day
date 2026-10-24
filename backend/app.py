import os
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager

# --- นำเข้า Blueprint และ Module ภายในโปรเจกต์ ---
from config.database import get_db_connection
from routes.analysis import analysis_bp
from routes.articles import articles_bp
from routes.auth import auth_bp
from routes.history import history_bp
from routes.profile import profile_bp

# โหลดค่าต่าง ๆ จากไฟล์ .env
load_dotenv()

app = Flask(__name__)

# --- 1. ตั้งค่า CORS ---
CORS(
    app,
    resources={
        r"/*": {
            "origins": [
                "http://localhost:3000",
                "https://luna-day-health.vercel.app",
                "https://lunar-day-git-backend-problem-lunar-2500.vercel.app"
            ]
        }
    },
)
SERVER_URL = os.getenv(
    "SERVER_URL",
    "http://localhost:5000"
).rstrip("/")
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
MAIN_UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")


@app.route("/uploads/<path:filename>")
def serve_uploads(filename):
    return send_from_directory(MAIN_UPLOAD_FOLDER, filename)


# --- 2. ตั้งค่าระบบความปลอดภัย (JWT) ---
app.config["JWT_SECRET_KEY"] = os.environ["JWT_SECRET_KEY"]
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=24)
jwt = JWTManager(app)


@jwt.token_in_blocklist_loader
def check_if_token_revoked(jwt_header, jwt_payload):
    jti = jwt_payload["jti"]
    current_user_id = jwt_payload["sub"]

    db = get_db_connection()
    if not db:
        return True  # ป้องกันกรณีฐานข้อมูลล่ม ให้ระงับสิทธิ์ไว้ก่อน

    cursor = db.cursor(dictionary=True)
    try:
        # ตรวจสอบใน TokenBlacklist
        cursor.execute(
            "SELECT TokenID FROM TokenBlacklist WHERE JTI = %s", (jti,)
        )
        token = cursor.fetchone()
        if token:
            return True

        # ตรวจสอบว่าผู้ใช้ยังมีตัวตนในระบบหรือไม่
        cursor.execute(
            "SELECT UserID FROM User WHERE UserID = %s",
            (current_user_id,),
        )
        user = cursor.fetchone()
        if not user:
            return True

        return False
    finally:
        cursor.close()
        db.close()


@jwt.revoked_token_loader
def custom_revoked_token_callback(jwt_header, jwt_payload):
    return (
        jsonify(
            {"status": "error", "msg": "บัญชีผู้ใช้นี้ถูกลบออกจากระบบแล้ว"}
        ),
        401,
    )


# --- 3. ลงทะเบียน Blueprint (Route ทั้งหมด) ---
app.register_blueprint(auth_bp, url_prefix="/auth")
app.register_blueprint(articles_bp, url_prefix="/")
app.register_blueprint(analysis_bp, url_prefix="/analysis")
app.register_blueprint(profile_bp, url_prefix="/profile")
app.register_blueprint(history_bp, url_prefix="/history")


@app.route("/")
def index():
    return {
        "message": "Luna Day API is running!",
        "version": "1.0.0",
        "status": "success",
    }, 200


if __name__ == "__main__":
    app.run(
        debug=False,
        host="0.0.0.0",
        port=5000,
        use_reloader=False,
    )
