FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . /app

# Expose the standard Cloud Run port
EXPOSE 8080

# Command to run the standard uvicorn worker
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
