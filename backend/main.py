import sys
import traceback

# Принудительно выводим всё в stderr, чтобы Render поймал
sys.stderr = sys.stdout

print("=== НАЧАЛО ЗАГРУЗКИ main.py ===", flush=True)

try:
    print("Импорт FastAPI...", flush=True)
    from fastapi import FastAPI
    print("FastAPI импортирован", flush=True)
except Exception as e:
    print(f"ОШИБКА импорта FastAPI: {e}", flush=True)
    traceback.print_exc()
    sys.exit(1)

try:
    print("Импорт StaticFiles...", flush=True)
    from fastapi.staticfiles import StaticFiles
    print("StaticFiles импортирован", flush=True)
except Exception as e:
    print(f"ОШИБКА импорта StaticFiles: {e}", flush=True)
    traceback.print_exc()
    sys.exit(1)

print("Создание приложения...", flush=True)
app = FastAPI()

@app.get("/")
def root():
    return {"status": "ok", "message": "Test server running"}

print("Подключение статики...", flush=True)
import os
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
    print(f"Статика подключена из {frontend_path}", flush=True)
else:
    print(f"Предупреждение: папка frontend не найдена по пути {frontend_path}", flush=True)

print("=== ЗАГРУЗКА main.py ЗАВЕРШЕНА УСПЕШНО ===", flush=True)
