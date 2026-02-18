import logging
import uuid
import os
import shutil
import asyncio
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Импорты с префиксом backend
from backend.database import get_db_connection, init_db, hash_password, verify_password
from backend.auth import create_access_token, verify_token, get_current_user
from backend.models import UserCreate, UserLogin, Post, Comment, Message

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- Lifespan для фоновой задачи ----------
async def delete_old_posts_and_messages():
    """Фоновая задача: удалять посты и сообщения старше 64 часов"""
    while True:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cutoff = (datetime.now() - timedelta(hours=64)).isoformat()

            # Удаляем старые посты (каскадно удалятся комментарии и реакции)
            cursor.execute("DELETE FROM posts WHERE timestamp < %s", (cutoff,))
            deleted_posts = cursor.rowcount

            # Удаляем старые сообщения
            cursor.execute("DELETE FROM messages WHERE timestamp < %s", (cutoff,))
            deleted_messages = cursor.rowcount

            conn.commit()
            conn.close()
            logger.info(f"🧹 Cleanup: deleted {deleted_posts} old posts and {deleted_messages} old messages")
        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")

        await asyncio.sleep(3600)  # 1 час

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Запускаем фоновую задачу при старте
    task = asyncio.create_task(delete_old_posts_and_messages())
    yield
    # Отменяем задачу при остановке
    task.cancel()

# ---------- Создание приложения ----------
app = FastAPI(
    title="Монеточка API",
    version="1.0.0",
    lifespan=lifespan
)

# ---------- CORS ----------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Папка для загруженных файлов ----------
os.makedirs("uploads/images", exist_ok=True)
os.makedirs("uploads/videos", exist_ok=True)
os.makedirs("uploads/avatars", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ---------- Инициализация базы данных ----------
init_db()
logger.info("✅ Database initialized")

# ---------- Публичные маршруты ----------
@app.post("/register")
async def register(user_data: UserCreate):
    logger.info(f"POST /register called with email: {user_data.email}")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE email = %s OR username = %s", (user_data.email, user_data.username))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email or username already exists")
    user_id = str(uuid.uuid4())
    password_hash = hash_password(user_data.password)
    try:
        cursor.execute(
            "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (%s, %s, %s, %s, %s)",
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
    cursor.execute("SELECT id, password_hash FROM users WHERE email = %s", (login_data.email,))
    user = cursor.fetchone()
    conn.close()
    if not user or not verify_password(login_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": user["id"]})
    logger.info(f"User {user['id']} logged in")
    return {"access_token": access_token, "token_type": "bearer", "user_id": user["id"]}

# ---------- Защищённые маршруты ----------
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
        cursor.execute("SELECT id FROM users WHERE email = %s AND id != %s", (updates["email"], current_user["id"]))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(400, "Email already used")
    if "username" in updates:
        cursor.execute("SELECT id FROM users WHERE username = %s AND id != %s", (updates["username"], current_user["id"]))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(400, "Username already taken")
    set_clause = ", ".join([f"{k} = %s" for k in updates.keys()])
    values = list(updates.values()) + [current_user["id"]]
    cursor.execute(f"UPDATE users SET {set_clause} WHERE id = %s", values)
    conn.commit()
    cursor.execute("SELECT id, username, email, avatar_url, coins, created_at FROM users WHERE id = %s", (current_user["id"],))
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
            "INSERT INTO posts (id, user_id, content, media_url, media_type, timestamp) VALUES (%s, %s, %s, %s, %s, %s)",
            (post_id, current_user["id"], content, media_url, media_type, datetime.now().isoformat())
        )
        cursor.execute("UPDATE users SET coins = coins + 5 WHERE id = %s", (current_user["id"],))
        new_coins = cursor.execute("SELECT coins FROM users WHERE id = %s", (current_user["id"],)).fetchone()["coins"]
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
        LIMIT %s OFFSET %s
    ''', (limit, offset))
    posts = cursor.fetchall()
    conn.close()
    return [dict(post) for post in posts]

@app.put("/posts/{post_id}")
async def update_post(post_id: str, post_data: dict, current_user: dict = Depends(get_current_user)):
    content = post_data.get("content")
    if not content:
        raise HTTPException(400, "Content required")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM posts WHERE id = %s", (post_id,))
    post = cursor.fetchone()
    if not post:
        conn.close()
        raise HTTPException(404, "Post not found")
    if post["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Not authorized to edit this post")
    cursor.execute("UPDATE posts SET content = %s WHERE id = %s", (content, post_id))
    conn.commit()
    conn.close()
    return {"message": "Post updated"}

@app.delete("/posts/{post_id}")
async def delete_post(post_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM posts WHERE id = %s", (post_id,))
    post = cursor.fetchone()
    if not post:
        conn.close()
        raise HTTPException(404, "Post not found")
    if post["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Not authorized to delete this post")
    cursor.execute("DELETE FROM posts WHERE id = %s", (post_id,))
    conn.commit()
    conn.close()
    return {"message": "Post deleted"}

@app.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM posts WHERE id = %s", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    cursor.execute("SELECT reaction_type FROM post_reactions WHERE user_id = %s AND post_id = %s", (current_user["id"], post_id))
    existing = cursor.fetchone()
    coins_earned = 0
    message = ""
    try:
        if existing:
            if existing["reaction_type"] == "like":
                cursor.execute("UPDATE posts SET likes = likes - 1 WHERE id = %s", (post_id,))
                cursor.execute("DELETE FROM post_reactions WHERE user_id = %s AND post_id = %s", (current_user["id"], post_id))
                message = "Like removed"
            else:
                cursor.execute("UPDATE posts SET dislikes = dislikes - 1, likes = likes + 1 WHERE id = %s", (post_id,))
                cursor.execute("UPDATE post_reactions SET reaction_type = 'like' WHERE user_id = %s AND post_id = %s", (current_user["id"], post_id))
                message = "Reaction changed to like"
        else:
            cursor.execute("UPDATE posts SET likes = likes + 1 WHERE id = %s", (post_id,))
            cursor.execute("INSERT INTO post_reactions (user_id, post_id, reaction_type, timestamp) VALUES (%s, %s, %s, %s)",
                           (current_user["id"], post_id, "like", datetime.now().isoformat()))
            cursor.execute("UPDATE users SET coins = coins + 1 WHERE id = %s", (current_user["id"],))
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
    cursor.execute("SELECT id FROM posts WHERE id = %s", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    cursor.execute("SELECT reaction_type FROM post_reactions WHERE user_id = %s AND post_id = %s", (current_user["id"], post_id))
    existing = cursor.fetchone()
    coins_earned = 0
    message = ""
    try:
        if existing:
            if existing["reaction_type"] == "dislike":
                cursor.execute("UPDATE posts SET dislikes = dislikes - 1 WHERE id = %s", (post_id,))
                cursor.execute("DELETE FROM post_reactions WHERE user_id = %s AND post_id = %s", (current_user["id"], post_id))
                message = "Dislike removed"
            else:
                cursor.execute("UPDATE posts SET likes = likes - 1, dislikes = dislikes + 1 WHERE id = %s", (post_id,))
                cursor.execute("UPDATE post_reactions SET reaction_type = 'dislike' WHERE user_id = %s AND post_id = %s", (current_user["id"], post_id))
                message = "Reaction changed to dislike"
        else:
            cursor.execute("UPDATE posts SET dislikes = dislikes + 1 WHERE id = %s", (post_id,))
            cursor.execute("INSERT INTO post_reactions (user_id, post_id, reaction_type, timestamp) VALUES (%s, %s, %s, %s)",
                           (current_user["id"], post_id, "dislike", datetime.now().isoformat()))
            cursor.execute("UPDATE users SET coins = coins + 1 WHERE id = %s", (current_user["id"],))
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
    cursor.execute("SELECT id FROM posts WHERE id = %s", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    comment_id = str(uuid.uuid4())
    try:
        cursor.execute(
            "INSERT INTO comments (id, post_id, user_id, content, timestamp) VALUES (%s, %s, %s, %s, %s)",
            (comment_id, post_id, current_user["id"], content, datetime.now().isoformat())
        )
        cursor.execute("UPDATE users SET coins = coins + 2 WHERE id = %s", (current_user["id"],))
        new_coins = cursor.execute("SELECT coins FROM users WHERE id = %s", (current_user["id"],)).fetchone()["coins"]
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
    cursor.execute("SELECT id FROM posts WHERE id = %s", (post_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Post not found")
    cursor.execute('''
        SELECT c.*, u.username, u.avatar_url
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = %s
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
            CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END as other_user_id
        FROM messages
        WHERE sender_id = %s OR receiver_id = %s
    ''', (current_user["id"], current_user["id"], current_user["id"]))
    other_ids = [row["other_user_id"] for row in cursor.fetchall()]
    conversations = []
    for other_id in other_ids:
        cursor.execute('''
            SELECT content, timestamp, sender_id
            FROM messages
            WHERE (sender_id = %s AND receiver_id = %s) OR (sender_id = %s AND receiver_id = %s)
            ORDER BY timestamp DESC LIMIT 1
        ''', (current_user["id"], other_id, other_id, current_user["id"]))
        last_msg = cursor.fetchone()
        cursor.execute("SELECT id, username, avatar_url FROM users WHERE id = %s", (other_id,))
        user_info = cursor.fetchone()
        if user_info and last_msg:
            cursor.execute('''
                SELECT COUNT(*) FROM messages
                WHERE sender_id = %s AND receiver_id = %s AND is_read = FALSE
            ''', (other_id, current_user["id"]))
            unread = cursor.fetchone()["count"]
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
        WHERE (sender_id = %s AND receiver_id = %s) OR (sender_id = %s AND receiver_id = %s)
        ORDER BY timestamp ASC
    ''', (current_user["id"], user_id, user_id, current_user["id"]))
    messages = cursor.fetchall()
    cursor.execute('''
        UPDATE messages SET is_read = TRUE
        WHERE sender_id = %s AND receiver_id = %s AND is_read = FALSE
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
    cursor.execute("SELECT id FROM users WHERE id = %s", (receiver_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(404, "Receiver not found")
    try:
        cursor.execute('''
            INSERT INTO messages (id, sender_id, receiver_id, content, timestamp, is_read)
            VALUES (%s, %s, %s, %s, %s, %s)
        ''', (msg_id, current_user["id"], receiver_id, content, datetime.now().isoformat(), False))
        conn.commit()
    except Exception as e:
        conn.close()
        logger.error(f"Send message error: {e}")
        raise HTTPException(500, "Database error")
    conn.close()
    return {"id": msg_id}

# ---------- Пользователи и поиск ----------
@app.get("/users")
async def get_all_users(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, avatar_url, coins FROM users WHERE id != %s ORDER BY username", (current_user["id"],))
    users = cursor.fetchall()
    conn.close()
    return [dict(user) for user in users]

@app.get("/users/search")
async def search_users(query: str = Query(..., min_length=1), current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, avatar_url, coins
        FROM users
        WHERE username ILIKE %s AND id != %s
        LIMIT 20
    ''', (f"%{query}%", current_user["id"]))
    users = cursor.fetchall()
    conn.close()
    return [dict(user) for user in users]

@app.get("/users/{user_id}")
async def get_user_by_id(user_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, avatar_url, coins FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    conn.close()
    if not user:
        raise HTTPException(404, "User not found")
    return dict(user)

# ---------- Таблица лидеров ----------
@app.get("/leaderboard")
async def get_leaderboard(limit: int = 10):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, avatar_url, coins, 
               CASE 
                   WHEN coins >= 1000 THEN 'Богач'
                   WHEN coins >= 500 THEN 'Активный'
                   WHEN coins >= 100 THEN 'Новичок'
                   ELSE 'Зритель'
               END as title
        FROM users 
        ORDER BY coins DESC 
        LIMIT %s
    """, (limit,))
    users = cursor.fetchall()
    conn.close()
    return [dict(user) for user in users]

# ---------- Онлайн пользователи ----------
@app.get("/online-users")
async def get_online_users(current_user: dict = Depends(get_current_user)):
    five_min_ago = (datetime.now() - timedelta(minutes=5)).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, avatar_url 
        FROM users 
        WHERE last_active >= %s AND id != %s
        ORDER BY username
    """, (five_min_ago, current_user["id"]))
    users = cursor.fetchall()
    conn.close()
    return [dict(user) for user in users]

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
    cursor.execute("UPDATE users SET avatar_url = %s WHERE id = %s", (avatar_url, current_user["id"]))
    conn.commit()
    conn.close()
    return {"avatar_url": avatar_url}

# ---------- Подключение фронтенда ----------
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

# ---------- Запуск (для локальной разработки) ----------
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)