import asyncio
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

# Функция для удаления старых записей
async def delete_old_posts_and_messages():
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

# Используем lifespan для запуска фоновой задачи
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Запускаем задачу при старте
    task = asyncio.create_task(delete_old_posts_and_messages())
    yield
    # Отменяем задачу при остановке
    task.cancel()

# Обновите создание приложения, добавив lifespan
app = FastAPI(title="Монеточка API", version="1.0.0", lifespan=lifespan)