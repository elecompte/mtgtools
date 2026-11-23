# For more information, please refer to https://aka.ms/vscode-docker-python
FROM python:3-slim

EXPOSE 5002

# Keeps Python from generating .pyc files in the container
ENV PYTHONDONTWRITEBYTECODE=1

# Turns off buffering for easier container logging
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install pip requirements
COPY requirements.txt .
RUN python -m pip install -r requirements.txt

# Create the runtime user before copying the application so Docker can assign
# ownership while copying instead of walking the entire build context later.
RUN adduser -u 5678 --disabled-password --gecos "" appuser
RUN mkdir /data && chown appuser:appuser /data
COPY --chown=appuser:appuser . .
USER appuser

# During debugging, this entry point will be overridden. For more information,
# please refer to https://aka.ms/vscode-docker-python-debug
CMD ["gunicorn", "--bind", "0.0.0.0:5002", "app:app", "--timeout", "300"]
