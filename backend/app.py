from datetime import timedelta
from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_bcrypt import Bcrypt
import os
from dotenv import load_dotenv

# --- นำเข้า Blueprint จากโฟลเดอร์ routes ---
from routes.auth import auth_bp
from routes.articles import articles_bp
from routes.analysis import UPLOAD_FOLDER, analysis_bp
from routes.profile import profile_bp
from routes.history import history_bp
from config.database import get_db_connection

# โหลดค่าจากไฟล์ .env
load_dotenv()

app = Flask(__name__)


# --- 1. ตั้งค่า CORS ---
CORS(
    app,
    resources={
        r"/*": {
            "origins": [
                "http://localhost:3000",
                "http://192.168.1.16:3000"
            ]
        }
    }
)


# --- 2. ตั้งค่าระบบความปลอดภัย (JWT) ---
app.config["JWT_SECRET_KEY"] = os.environ["JWT_SECRET_KEY"]
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=24)
jwt = JWTManager(app)

@jwt.token_in_blocklist_loader
def check_if_token_revoked(jwt_header, jwt_payload):
    jti = jwt_payload["jti"]

    db = get_db_connection()
    if not db:
        return True #
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute("SELECT TokenID FROM TokenBlacklist WHERE JTI = %s", (jti,))
        token = cursor.fetchone()
        return token is not None
    finally:
        cursor.close()
        db.close()

# --- 3. ตั้งค่า Bcrypt ---
# ใช้สำหรับแฮชรหัสผ่านในระบบ
bcrypt = Bcrypt(app)

# --- 4. ลงทะเบียน Blueprint (Route ทั้งหมด) ---

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
        use_reloader=False
    )
