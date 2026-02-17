import logging
import uuid
import os
import shutil
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

# Импорты из модулей проекта (лежат в той же папке backend)
from database import get_db_connection, init_db, hash_password, verify_password
from auth import create_access_token, verify_token, get_current_user
from models import UserCreate, UserLogin, Post, Comment, Message

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CoinSocial API", version="1.0.0")

# Разрешаем CORS (для доступа с фронтенда)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Папка для загруженных файлов (создаётся внутри backend)
os.makedirs("uploads/images", exist_ok=True)
os.makedirs("uploads/videos", exist_ok=True)
os.makedirs("uploads/avatars", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Инициализация базы данных
init_db()
logger.info("✅ Database initialized")

# ---------- Публичные маршруты ----------
@app.post("/register")
async def register(user_data: UserCreate):
    logger.info(f"POST /register called with email: {user_data.email}")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE email = ? OR username = ?", (user_data.email, user_data.username))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email or username already exists")
    user_id = str(uuid.uuid4())
    password_hash = hash_password(user_data.password)
    try:
        cursor.execute(
            "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, user_data.username, user_data.email, password_hash, datetime.now().isoformat())
        )
        conn.commit()
        logger.info(f"User {user_data.username} registered with ID {user_id}")
    except Exception as e:
        conn.close()
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    conn.close()
    access_token = create_access_token(data={"sub": user_id})
    return {"access_token": access_token, "token_type": "bearer", "user_id": user_id}

@app.post("/login")
async def login(login_data: UserLogin):
    logger.info(f"POST /login called with email: {login_data.email}")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE email = ?", (login_data.email,))
    user = cursor.fetchone()
    conn.close()
    if not user or not verify_password(login_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": user["id"]})
    logger.info(f"User {user['id']} logged in")
    return {"access_token": access_token, "token_type": "bearer", "user_id": user["id"]}

# ---------- Защищённые маршруты (требуется JWT) ----------
@app.get("/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    return current_user

@app.put("/profile")
async def update_profile(update_data: dict, current_user: dict = Depends(get_current_user)):
    allowed_fields = {"username", "email"}
    updates = {k: v for k, v in update_data.items() if k in allowed_fields}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    conn = get_db_connection()
    cursor = conn.cursor()
    if "email" in updates:
        cursor.execute("SELECT id FROM users WHERE email = ? AND id != ?", (updates["email"], current_user["id"]))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(400, "Email already used")
    if "username" in updates:
        cursor.execute("SELECT id FROM users WHERE username = ? AND id != ?", (updates["username"], current_user["id"]))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(400, "Username already taken")
    set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
    values = list(updates.values()) + [current_user["id"]]
    cursor.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    conn.commit()
    cursor.execute("SELECT id, username, email, avatar_url, coins, created_at FROM users WHERE id = ?", (current_user["id"],))
    updated = cursor.fetchone()
    conn.close()
    return dict(updated)

@app.post("/posts")
async def create_post(post_data: dict, current_user: dict = Depends(get_current_user)):
    content = post_data.get("content")
    media_url = post_data.get("media_url")
    if not content:
        raise HTTPException(400, "Content is required")
    post_id = str(uuid.uuid4())
    media_type = None
    if media_url:
        ext = os.path.splitext(media_url)[1].lower()
        if ext in ['.jpg','.jpeg','.png','.gif','.webp']:
            media_type = "image"
        elif ext in ['.mp4','.avi','.mov','.webm']:
            media_type = "video"
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO posts (id, user_id, content, media_url, media_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (post_id, current_user["id"], content, media_url, media_type, datetime.now().isoformat())
        )
        cursor.execute("UPDATE users SET coins = coins + 5 WHERE id = ?", (current_user["id"],))
        new_coins = cursor.execute("SELECT coins FROM users WHERE id = ?", (current_user["id"],)).fetchone()["coins"]
        conn.commit()
        logger.info(f"Post {post_id} created by user {current_user['id']}")
    except Exception as e:
        conn.close()
        logger.error(f"Post creation error: {e}")
        raise HTTPException(500, "Database error")
    conn.close()
    return {"post_id": post_id, "coins_earned": 5, "new_balance": new_coins}

@app.get("/feed")
async def get_feed(limit: int = 20, offset: int = 0):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT p.*, u.username, u.avatar_url,
               (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.timestamp DESC
        LIMIT ? OFFSET ?
    ''', (limit, offset))
    posts = cursor.fetchall()
    conn.close()
    return [dict(post) for post in posts]

@app.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM posts WHERE id = ?", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    cursor.execute("SELECT reaction_type FROM post_reactions WHERE user_id = ? AND post_id = ?", (current_user["id"], post_id))
    existing = cursor.fetchone()
    coins_earned = 0
    message = ""
    try:
        if existing:
            if existing["reaction_type"] == "like":
                cursor.execute("UPDATE posts SET likes = likes - 1 WHERE id = ?", (post_id,))
                cursor.execute("DELETE FROM post_reactions WHERE user_id = ? AND post_id = ?", (current_user["id"], post_id))
                message = "Like removed"
            else:
                cursor.execute("UPDATE posts SET dislikes = dislikes - 1, likes = likes + 1 WHERE id = ?", (post_id,))
                cursor.execute("UPDATE post_reactions SET reaction_type = 'like' WHERE user_id = ? AND post_id = ?", (current_user["id"], post_id))
                message = "Reaction changed to like"
        else:
            cursor.execute("UPDATE posts SET likes = likes + 1 WHERE id = ?", (post_id,))
            cursor.execute("INSERT INTO post_reactions (user_id, post_id, reaction_type, timestamp) VALUES (?, ?, ?, ?)",
                           (current_user["id"], post_id, "like", datetime.now().isoformat()))
            cursor.execute("UPDATE users SET coins = coins + 1 WHERE id = ?", (current_user["id"],))
            coins_earned = 1
            message = "Post liked"
        conn.commit()
    except Exception as e:
        conn.close()
        logger.error(f"Like error: {e}")
        raise HTTPException(500, "Database error")
    conn.close()
    return {"message": message, "coins_earned": coins_earned}

@app.post("/posts/{post_id}/dislike")
async def dislike_post(post_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM posts WHERE id = ?", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    cursor.execute("SELECT reaction_type FROM post_reactions WHERE user_id = ? AND post_id = ?", (current_user["id"], post_id))
    existing = cursor.fetchone()
    coins_earned = 0
    message = ""
    try:
        if existing:
            if existing["reaction_type"] == "dislike":
                cursor.execute("UPDATE posts SET dislikes = dislikes - 1 WHERE id = ?", (post_id,))
                cursor.execute("DELETE FROM post_reactions WHERE user_id = ? AND post_id = ?", (current_user["id"], post_id))
                message = "Dislike removed"
            else:
                cursor.execute("UPDATE posts SET likes = likes - 1, dislikes = dislikes + 1 WHERE id = ?", (post_id,))
                cursor.execute("UPDATE post_reactions SET reaction_type = 'dislike' WHERE user_id = ? AND post_id = ?", (current_user["id"], post_id))
                message = "Reaction changed to dislike"
        else:
            cursor.execute("UPDATE posts SET dislikes = dislikes + 1 WHERE id = ?", (post_id,))
            cursor.execute("INSERT INTO post_reactions (user_id, post_id, reaction_type, timestamp) VALUES (?, ?, ?, ?)",
                           (current_user["id"], post_id, "dislike", datetime.now().isoformat()))
            cursor.execute("UPDATE users SET coins = coins + 1 WHERE id = ?", (current_user["id"],))
            coins_earned = 1
            message = "Post disliked"
        conn.commit()
    except Exception as e:
        conn.close()
        logger.error(f"Dislike error: {e}")
        raise HTTPException(500, "Database error")
    conn.close()
    return {"message": message, "coins_earned": coins_earned}

@app.post("/posts/{post_id}/comments")
async def create_comment(post_id: str, comment_data: dict, current_user: dict = Depends(get_current_user)):
    content = comment_data.get("content")
    if not content:
        raise HTTPException(400, "Content required")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM posts WHERE id = ?", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    comment_id = str(uuid.uuid4())
    try:
        cursor.execute(
            "INSERT INTO comments (id, post_id, user_id, content, timestamp) VALUES (?, ?, ?, ?, ?)",
            (comment_id, post_id, current_user["id"], content, datetime.now().isoformat())
        )
        cursor.execute("UPDATE users SET coins = coins + 2 WHERE id = ?", (current_user["id"],))
        new_coins = cursor.execute("SELECT coins FROM users WHERE id = ?", (current_user["id"],)).fetchone()["coins"]
        conn.commit()
    except Exception as e:
        conn.close()
        logger.error(f"Comment creation error: {e}")
        raise HTTPException(500, "Database error")
    conn.close()
    return {"comment_id": comment_id, "coins_earned": 2, "new_balance": new_coins}

@app.get("/posts/{post_id}/comments")
async def get_comments(post_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM posts WHERE id = ?", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    cursor.execute('''
        SELECT c.*, u.username, u.avatar_url
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.timestamp ASC
    ''', (post_id,))
    comments = cursor.fetchall()
    conn.close()
    return [dict(comment) for comment in comments]

# ---------- Сообщения ----------
@app.get("/messages/conversations")
async def get_conversations(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT DISTINCT
            CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_user_id
        FROM messages
        WHERE sender_id = ? OR receiver_id = ?
    ''', (current_user["id"], current_user["id"], current_user["id"]))
    other_ids = [row["other_user_id"] for row in cursor.fetchall()]
    conversations = []
    for other_id in other_ids:
        cursor.execute('''
            SELECT content, timestamp, sender_id
            FROM messages
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY timestamp DESC LIMIT 1
        ''', (current_user["id"], other_id, other_id, current_user["id"]))
        last_msg = cursor.fetchone()
        cursor.execute("SELECT id, username, avatar_url FROM users WHERE id = ?", (other_id,))
        user_info = cursor.fetchone()
        if user_info and last_msg:
            cursor.execute('''
                SELECT COUNT(*) FROM messages
                WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
            ''', (other_id, current_user["id"]))
            unread = cursor.fetchone()[0]
            conversations.append({
                "user_id": user_info["id"],
                "username": user_info["username"],
                "avatar_url": user_info["avatar_url"],
                "last_message": last_msg["content"],
                "timestamp": last_msg["timestamp"],
                "unread_count": unread
            })
    conn.close()
    conversations.sort(key=lambda x: x["timestamp"], reverse=True)
    return conversations

@app.get("/messages/{user_id}")
async def get_messages(user_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM messages
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY timestamp ASC
    ''', (current_user["id"], user_id, user_id, current_user["id"]))
    messages = cursor.fetchall()
    cursor.execute('''
        UPDATE messages SET is_read = 1
        WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
    ''', (user_id, current_user["id"]))
    conn.commit()
    conn.close()
    return [dict(msg) for msg in messages]

@app.post("/messages/send")
async def send_message(message_data: dict, current_user: dict = Depends(get_current_user)):
    receiver_id = message_data.get("receiver_id")
    content = message_data.get("content")
    if not receiver_id or not content:
        raise HTTPException(400, "receiver_id and content required")
    msg_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE id = ?", (receiver_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Receiver not found")
    try:
        cursor.execute('''
            INSERT INTO messages (id, sender_id, receiver_id, content, timestamp, is_read)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (msg_id, current_user["id"], receiver_id, content, datetime.now().isoformat(), False))
        conn.commit()
    except Exception as e:
        conn.close()
        logger.error(f"Send message error: {e}")
        raise HTTPException(500, "Database error")
    conn.close()
    return {"id": msg_id}

# ---------- Поиск пользователей ----------
@app.get("/users/search")
async def search_users(query: str = Query(..., min_length=1), current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, avatar_url, coins
        FROM users
        WHERE username LIKE ? AND id != ?
        LIMIT 20
    ''', (f"%{query}%", current_user["id"]))
    users = cursor.fetchall()
    conn.close()
    return [dict(user) for user in users]

@app.get("/users/{user_id}")
async def get_user_by_id(user_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, avatar_url, coins FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()
    if not user:
        raise HTTPException(404, "User not found")
    return dict(user)

# ---------- Загрузка файлов ----------
@app.post("/upload/media")
async def upload_media(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if file.content_type.startswith("image/"):
        folder = "uploads/images"
        media_type = "image"
    elif file.content_type.startswith("video/"):
        folder = "uploads/videos"
        media_type = "video"
    else:
        raise HTTPException(400, "Only images and videos allowed")
    os.makedirs(folder, exist_ok=True)
    file_ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(folder, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    media_url = f"/{file_path}"
    return {"media_url": media_url, "media_type": media_type}

@app.post("/upload/avatar")
async def upload_avatar(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only images allowed")
    folder = "uploads/avatars"
    os.makedirs(folder, exist_ok=True)
    file_ext = os.path.splitext(file.filename)[1]
    filename = f"{current_user['id']}_{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(folder, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    avatar_url = f"/{file_path}"
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, current_user["id"]))
    conn.commit()
    conn.close()
    return {"avatar_url": avatar_url}

# ---------- Подключение фронтенда (ВАЖНО: этот код должен быть в самом конце) ----------
# Определяем путь к папке frontend (она находится на уровень выше backend)
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
# Монтируем всю папку frontend на корень сайта
# Параметр html=True позволяет автоматически отдавать index.html при запросе директории
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

# ---------- Запуск (для отладки) ----------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)