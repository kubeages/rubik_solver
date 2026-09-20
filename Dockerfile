FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 TABLE_DIR=/app/tables

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pruning tables of the two-phase solver (~5 s to build): baked into the image.
COPY cube/ cube/
RUN python -c "from cube import twophase; twophase.load_tables()" && chmod -R a+rX /app/tables

COPY app.py auth.py ./
COPY templates/ templates/
COPY static/ static/

EXPOSE 8080
USER 1001

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]
