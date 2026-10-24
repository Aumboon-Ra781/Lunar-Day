from flask import Blueprint, jsonify, request
from config.database import get_db_connection
import mysql.connector
import os
import logging
from config.config import SERVER_URL
from urllib.parse import urlparse
articles_bp = Blueprint("articles_bp", __name__)
# สร้างตัวแปร logger
logger = logging.getLogger(__name__)

# ----------------------------------------------
# Helper: จัดการ URL รูปภาพ
# ----------------------------------------------

def format_image_url(article):
    if article and article.get("ImageURL"):
        image_url = article["ImageURL"]

        # แปลง URL เต็มให้เหลือเฉพาะ path
        if image_url.startswith("http"):
            image_url = urlparse(image_url).path

        # ใช้ host ตามคำขอที่เข้ามา
        base_url = request.host_url.rstrip("/")

        article["ImageURL"] = (
            f"{base_url}/{image_url.lstrip('/')}"
        )

    return article


# ----------------------------------------------
# Helper: ปิด DB
# ----------------------------------------------
def close_db(cursor, db):
    if cursor is not None:
        cursor.close()
    if db is not None and db.is_connected():
        db.close()

# ----------------------------------------------
# 1. ดึงรายการบทความทั้งหมด
# ----------------------------------------------
@articles_bp.route("/articles", methods=["GET"])
def get_articles():
    db = get_db_connection()
    cursor = None

    if not db:
        logger.error("Database connection failed at GET /articles")
        return jsonify({"status": "error", "error_code": "A4", "msg": "ระบบไม่สามารถค้นหาข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"}), 500

    try:
        cursor = db.cursor(dictionary=True)

        sql = "SELECT ArticleID, Title, ImageURL FROM Article"
        cursor.execute(sql)
        articles = cursor.fetchall()

        # format image URL
        articles = [format_image_url(a) for a in articles]

        return jsonify(articles), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error fetching all articles: {err}")
        # Database Error คืนค่า A3 ตามเอกสาร
        return jsonify({"status":"error", "error_code": "A3", "msg": "ระบบไม่สามารถค้นหาข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        logger.error(f"System Error fetching all articles: {e}")
        # System Error คืนค่า A4 ตามเอกสาร
        return jsonify({"status":"error", "error_code": "A4", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        close_db(cursor, db)

# ----------------------------------------------
# 2. ดึงรายละเอียดบทความ
# ----------------------------------------------
@articles_bp.route("/articles/<int:article_id>", methods=["GET"])
def get_article_detail(article_id):
    db = get_db_connection()
    cursor = None

    if not db:
        logger.error(f"Database connection failed at GET /articles/{article_id}")
        return jsonify({"status": "error", "error_code": "A4", "msg": "ระบบไม่สามารถค้นหาข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"}), 500

    try:
        cursor = db.cursor(dictionary=True)

        sql = "SELECT * FROM Article WHERE ArticleID = %s"
        cursor.execute(sql, (article_id,))
        article = cursor.fetchone()

        if not article:
            # หาบทความไม่เจอ เป็น A3 ตามโค้ดดั้งเดิม
            return jsonify({"status":"error", "error_code":"A3", "msg": "ระบบไม่สามารถค้นหาข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"}), 404

        article = format_image_url(article)

        return jsonify(article), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error fetching article detail (ID: {article_id}): {err}")
        return jsonify({"status":"error", "error_code":"A3", "msg": "ระบบไม่สามารถค้นหาข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        logger.error(f"System Error fetching article detail (ID: {article_id}): {e}")
        return jsonify({"status":"error", "error_code":"A4", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        close_db(cursor, db)

# ----------------------------------------------
# 3. ค้นหาบทความ
# ----------------------------------------------
@articles_bp.route("/articles/search", methods=["GET"])
def search_articles():
    query = request.args.get("q", "").strip()

    db = get_db_connection()
    cursor = None

    if not db:
        logger.error(f"Database connection failed at GET /articles/search?q={query}")
        return jsonify({"status": "error", "error_code": "A4", "msg": "ระบบไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้"}), 500

    try:
        cursor = db.cursor(dictionary=True)

        sql = """
            SELECT ArticleID, Title, ImageURL 
            FROM Article 
            WHERE Title LIKE %s OR Content LIKE %s
        """
        cursor.execute(sql, (f"%{query}%", f"%{query}%"))
        results = cursor.fetchall()
        
        if not results:
            # ค้นหาไม่เจอ เป็น A1
            return jsonify({"status":"error", "error_code":"A1", "msg": "ไม่พบข้อมูลที่ค้นหา"}), 404
    
        results = [format_image_url(a) for a in results]
        return jsonify(results), 200

    except mysql.connector.Error as err:
        logger.error(f"Database Error searching articles (Query: '{query}'): {err}")
        return jsonify({"status":"error", "error_code":"A3", "msg": "ระบบไม่สามารถค้นหาข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"}), 500
    except Exception as e:
        logger.error(f"System Error searching articles (Query: '{query}'): {e}")
        return jsonify({"status":"error", "error_code":"A4", "msg": "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง"}), 500
    finally:
        close_db(cursor, db)