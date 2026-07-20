# School Student Live Class APIs

This document lists all backend APIs related to live classes, HLS streams, chat interaction, polling, and recordings for **School Students** in Eddva.

All these endpoints require a valid Bearer token for authentication and are relative to the API base URL (e.g. `http://localhost:3000/api/v1`).

---

## 1. Live Lectures

### List Scheduled Lectures
Fetches the list of all scheduled live lectures for the authenticated student's class/section.
* **Endpoint**: `GET /school/live/lectures`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "a47d7c18-97d8-4903-bdf2-f8c5c78b4f2c",
      "title": "Mathematics Integration",
      "description": "Introduction to Integration and Calculus",
      "scheduledFor": "2026-07-17T12:00:00.000Z",
      "status": "SCHEDULED",
      "teacherName": "Pratap kumar Das",
      "subjectName": "Mathematics",
      "className": "Class 10",
      "sectionName": "Section A"
    }
  ]
  ```

### List Active/Ongoing Live Lectures
Fetches all lectures that are currently live and broadcasting.
* **Endpoint**: `GET /school/live/lectures/live`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "a47d7c18-97d8-4903-bdf2-f8c5c78b4f2c",
      "title": "Mathematics Integration",
      "status": "LIVE",
      "streamKey": "stream_12345abcd"
    }
  ]
  ```

### Get Stream HLS URL
Retrieves the HLS playback URL (`.m3u8`) for an ongoing live lecture.
* **Endpoint**: `GET /school/live/lectures/:id/stream-url`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  {
    "streamUrl": "http://localhost:3000/api/v1/school/live/hls/stream_12345abcd/index.m3u8"
  }
  ```

---

## 2. Interaction (Hand Raise & Chat)

### Raise / Lower Hand
Raises or lowers the student's hand to request speaking permission from the teacher.
* **Endpoint**: `POST /school/live/lectures/:id/hand`
* **Access**: `STUDENT`
* **Request Body**:
  ```json
  {
    "raised": true
  }
  ```
* **Response**: `201 Created`
  ```json
  {
    "raised": true
  }
  ```

### Get Live Chat History
Fetches chat messages sent during the live lecture (up to 500 messages).
* **Endpoint**: `GET /school/live/lectures/:id/chat`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "c1a2e3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
      "userId": "b49ee8d3-4c33-448c-aa06-30dc8bfbee54",
      "userName": "Pratap Das",
      "message": "Hello Teacher, I have a doubt.",
      "createdAt": "2026-07-17T05:15:00.000Z"
    }
  ]
  ```

---

## 3. Polls (Q&A/Interactions)

### Get Active Poll
Fetches the currently active poll for the live lecture (if any).
* **Endpoint**: `GET /school/live/lectures/:id/polls/active`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  {
    "id": "d98e76c5-b432-10fa-bcde-ef0123456789",
    "question": "What is the derivative of x^2?",
    "options": ["x", "2x", "x^2", "2"],
    "status": "ACTIVE"
  }
  ```

### Vote/Respond to a Poll
Submits a student's answer/vote to an active poll.
* **Endpoint**: `POST /school/live/lectures/:id/polls/:pollId/vote`
* **Access**: `STUDENT`
* **Request Body**:
  ```json
  {
    "option": "2x"
  }
  ```
* **Response**: `201 Created`
  ```json
  {
    "success": true,
    "message": "Vote recorded successfully"
  }
  ```

### List All Polls
Lists all polls (active and ended) created during this lecture session.
* **Endpoint**: `GET /school/live/lectures/:id/polls`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "d98e76c5-b432-10fa-bcde-ef0123456789",
      "question": "What is the derivative of x^2?",
      "options": ["x", "2x", "x^2", "2"],
      "correctOption": "2x",
      "status": "ENDED",
      "votes": {
        "x": 2,
        "2x": 15,
        "x^2": 1,
        "2": 0
      }
    }
  ]
  ```

---

## 4. Recordings

### List Available Recordings
Fetches recorded sessions of past live lectures that the student has access to.
* **Endpoint**: `GET /school/live/recordings`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "e5c4d3b2-a109-876f-edcb-a10293847561",
      "title": "Introduction to Algebra",
      "recordedAt": "2026-07-16T10:00:00.000Z",
      "duration": 3600,
      "subjectName": "Mathematics",
      "teacherName": "Pratap kumar Das"
    }
  ]
  ```

### Get Recording Playback URL
Retrieves the URL for playback of a recorded lecture.
* **Endpoint**: `GET /school/live/lectures/:id/recording-url`
* **Access**: `STUDENT`, `TEACHER`, `INSTITUTE_ADMIN`, `SUPER_ADMIN`
* **Response**: `200 OK`
  ```json
  {
    "recordingUrl": "https://pub-22354a2b0e694b93bcce0d5fb28e22a2.r2.dev/recordings/algebra_recorded.mp4"
  }
  ```
