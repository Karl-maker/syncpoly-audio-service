# Audio Service API Documentation

## Base URL

```
http://localhost:3000/api/audio
```

## Authentication

All endpoints require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

The JWT token must contain the following payload:
- `userId` (string): User identifier
- `name` (string): User name
- `email` (string): User email

## Endpoints

### 1. Upload Audio File

Upload an audio file to the service. The file will be stored in S3 (if configured) and metadata saved to the database. Uploads are processed asynchronously and progress can be tracked via the upload job ID.

**Endpoint:** `POST /api/audio/upload`

**Authentication:** Required

**Content-Type:** `multipart/form-data`

**Request:**
- `file` (file, required): Audio file to upload (max 100MB)
  - Accepted MIME types: `audio/*`

**Response:** `202 Accepted`

```json
{
  "jobId": "upload-job-id",
  "status": "pending",
  "message": "Upload started",
  "audioFileId": null
}
```

**Response Fields:**
- `jobId` (string): Upload job ID to poll for progress
- `status` (string): Current status (`pending`, `uploading`, `completed`, `failed`)
- `message` (string): Status message
- `audioFileId` (string, optional): Audio file ID (only present when `status` is `completed`)

**Error Responses:**
- `400 Bad Request`: No file uploaded or invalid file type
- `401 Unauthorized`: Missing or invalid JWT token
- `500 Internal Server Error`: Upload failed

**Example:**

```bash
curl -X POST http://localhost:3000/api/audio/upload \
  -H "Authorization: Bearer <jwt-token>" \
  -F "file=@audio.wav"
```

---

### 1.1. Get Upload Progress

Poll the upload progress for a specific upload job.

**Endpoint:** `GET /api/audio/upload/:jobId/progress`

**Authentication:** Required

**URL Parameters:**
- `jobId` (string, required): Upload job ID returned from upload endpoint

**Response:** `200 OK`

```json
{
  "jobId": "upload-job-id",
  "status": "uploading",
  "progress": 45,
  "audioFileId": null,
  "filename": "audio.wav",
  "s3Bucket": "my-bucket",
  "s3Key": "users/user123/uuid-audio.wav",
  "error": null,
  "startedAt": "2024-01-15T10:30:00.000Z",
  "completedAt": null,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Response Fields:**
- `jobId` (string): Upload job ID
- `status` (string): Current status (`pending`, `uploading`, `completed`, `failed`)
- `progress` (number): Upload progress percentage (0-100)
- `audioFileId` (string, optional): Audio file ID (only present when `status` is `completed`)
- `filename` (string): Original filename
- `s3Bucket` (string, optional): S3 bucket name
- `s3Key` (string, optional): S3 object key
- `error` (string, optional): Error message (only present when `status` is `failed`)
- `startedAt` (string, optional): When upload started
- `completedAt` (string, optional): When upload completed
- `createdAt` (string): When job was created

**Error Responses:**
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Upload job does not belong to user
- `404 Not Found`: Upload job not found
- `500 Internal Server Error`: Failed to get upload progress

**Example:**

```bash
curl http://localhost:3000/api/audio/upload/upload-job-id/progress \
  -H "Authorization: Bearer <jwt-token>"
```

---

### 2. Process Audio

Start processing an uploaded audio file. This will transcribe the audio, generate embeddings, and store them in the vector store.

**Endpoint:** `POST /api/audio/process`

**Authentication:** Required

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "audioFileId": "audio-file-id",
  "vectorStoreType": "openai" | "in-memory",
  "skipTranscription": false,
  "skipEmbeddings": false,
  "skipVectorStore": false,
  "options": {}
}
```

**Request Fields:**
- `audioFileId` (string, required): ID of the audio file to process
- `vectorStoreType` (string, optional): Type of vector store to use (`"mongodb"`, `"openai"`, or `"in-memory"`). Default: `"mongodb"`
- `skipTranscription` (boolean, optional): Skip transcription step. Default: `false`
- `skipEmbeddings` (boolean, optional): Skip embedding generation. Default: `false`
- `skipVectorStore` (boolean, optional): Skip storing in vector store. Default: `false`
- `options` (object, optional): Additional processing options

**Response:** `202 Accepted`

```json
{
  "jobId": "processing-job-id",
  "status": "pending",
  "transcriptId": null,
  "message": "Processing started"
}
```

**Status Values:**
- `pending`: Job is queued
- `processing`: Job is currently running
- `completed`: Job finished successfully
- `failed`: Job encountered an error

**Error Responses:**
- `400 Bad Request`: Missing required fields
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Audio file does not belong to user
- `404 Not Found`: Audio file not found
- `500 Internal Server Error`: Processing failed

**Example:**

```bash
curl -X POST http://localhost:3000/api/audio/process \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "audioFileId": "audio-file-id",
    "vectorStoreType": "openai",
    "options": {}
  }'
```

---

### 2.1. Get Transcript

Retrieve the transcript for a processed audio file.

**Endpoint:** `GET /api/audio/:audioFileId/transcript`

**Authentication:** Required

**URL Parameters:**
- `audioFileId` (string, required): ID of the audio file

**Response:** `200 OK`

```json
{
  "id": "transcript-id",
  "audioSourceId": "bucket/key",
  "audioSourceProvider": "s3",
  "language": "en",
  "speakers": [
    {
      "id": "speaker_1",
      "displayName": "Speaker 1"
    },
    {
      "id": "speaker_2",
      "displayName": "Speaker 2"
    }
  ],
  "segments": [
    {
      "id": "seg_0",
      "speakerId": "speaker_1",
      "text": "Hello, how are you?",
      "startTimeSec": 0.0,
      "endTimeSec": 2.5
    },
    {
      "id": "seg_1",
      "speakerId": "speaker_2",
      "text": "I'm doing well, thank you!",
      "startTimeSec": 2.5,
      "endTimeSec": 5.0
    }
  ],
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Response Fields:**
- `id` (string): Transcript ID
- `audioSourceId` (string): Audio source identifier (e.g., "bucket/key")
- `audioSourceProvider` (string): Type of audio source (e.g., "s3")
- `language` (string): Detected language code
- `speakers` (array): List of speakers in the transcript
  - `id` (string): Speaker identifier
  - `displayName` (string): Display name for the speaker
- `segments` (array): Transcript segments with timestamps
  - `id` (string): Segment identifier
  - `speakerId` (string): Speaker who said this segment
  - `text` (string): Transcribed text
  - `startTimeSec` (number): Start time in seconds
  - `endTimeSec` (number): End time in seconds
- `createdAt` (string): When transcript was created

**Error Responses:**
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Audio file does not belong to user
- `404 Not Found`: Audio file or transcript not found
- `500 Internal Server Error`: Failed to get transcript

**Example:**

```bash
curl http://localhost:3000/api/audio/audio-file-id/transcript \
  -H "Authorization: Bearer <jwt-token>"
```

---

### 3. Get Memory Usage

Retrieve memory usage statistics for a user, including total storage, number of audio files, and vector store records.

**Endpoint:** `GET /api/audio/memory/:userId`

**Authentication:** Required

**URL Parameters:**
- `userId` (string, required): User ID (must match authenticated user)

**Response:** `200 OK`

```json
{
  "userId": "user123",
  "totalAudioFiles": 5,
  "totalStorageBytes": 52428800,
  "totalStorageMB": 50.0,
  "totalStorageGB": 0.049,
  "totalVectorStoreRecords": 150,
  "vectorStoreMemoryBytes": 153600,
  "vectorStoreMemoryMB": 0.15,
  "lastCalculatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Response Fields:**
- `userId` (string): User identifier
- `totalAudioFiles` (number): Total number of audio files uploaded
- `totalStorageBytes` (number): Total storage used in bytes
- `totalStorageMB` (number): Total storage in megabytes
- `totalStorageGB` (number): Total storage in gigabytes
- `totalVectorStoreRecords` (number): Number of records in vector store
- `vectorStoreMemoryBytes` (number, optional): Estimated memory used by vector store in bytes
- `vectorStoreMemoryMB` (number, optional): Estimated memory in megabytes
- `lastCalculatedAt` (string): Timestamp of last calculation

**Error Responses:**
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Cannot view other users' memory usage
- `500 Internal Server Error`: Failed to calculate memory usage

**Example:**

```bash
curl http://localhost:3000/api/audio/memory/user123 \
  -H "Authorization: Bearer <jwt-token>"
```

---

### 4. Chat with Audio Content

Chat with an LLM about audio content. The LLM uses the vector store to retrieve relevant context from transcriptions and provides streaming responses.

**Endpoint:** `POST /api/audio/chat`

**Authentication:** Required

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "message": "What topics were discussed in the meeting?",
  "audioFileId": "audio-file-id",
  "topK": 5
}
```

**Request Fields:**
- `message` (string, required): User's question or message
- `audioFileId` (string, optional): Specific audio file ID to search within. If omitted, searches across all user's audio files
- `topK` (number, optional): Number of relevant chunks to retrieve. Default: `5`

**Response:** `200 OK` (Server-Sent Events stream)

The response is streamed using Server-Sent Events (SSE). Each chunk is sent as:

```
data: {"content": "chunk of text"}
data: {"content": "more text"}
data: {"done": true}
```

**Error Response Format:**

```
data: {"error": "Error message"}
```

**Error Responses:**
- `400 Bad Request`: Missing or invalid message
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Audio file does not belong to user
- `404 Not Found`: Audio file not found (if audioFileId provided)
- `500 Internal Server Error`: Chat processing failed

**Example:**

```bash
curl -X POST http://localhost:3000/api/audio/chat \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What was discussed in the meeting?",
    "audioFileId": "audio-file-id",
    "topK": 5
  }'
```

**JavaScript Example (with EventSource):**

```javascript
const eventSource = new EventSource('http://localhost:3000/api/audio/chat', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <jwt-token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: "What topics were discussed?",
    audioFileId: "audio-file-id",
    topK: 5
  })
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.content) {
    console.log(data.content); // Streamed text chunk
  }
  if (data.done) {
    eventSource.close();
  }
  if (data.error) {
    console.error(data.error);
    eventSource.close();
  }
};
```

---

### 5. Generate Breakdown

Automatically generate a structured breakdown of an audio file's transcript. The breakdown includes an introduction, bullet points, main takeaways, action items (tasks), and questions. This endpoint uses AI to analyze the transcript and extract structured information.

**Endpoint:** `POST /api/audio/:audioFileId/breakdown/generate`

**Authentication:** Required

**URL Parameters:**
- `audioFileId` (string, required): ID of the audio file to generate breakdown for

**Response:** `200 OK`

```json
{
  "id": "breakdown-id",
  "audioFileId": "audio-file-id",
  "introduction": "This audio discusses the quarterly business review meeting...",
  "bulletPoints": [
    "Q4 revenue increased by 15%",
    "New product launch scheduled for Q2",
    "Team expansion planned for engineering department"
  ],
  "mainTakeaways": [
    "Strong financial performance in Q4",
    "Focus on product innovation",
    "Investment in team growth"
  ],
  "actionItems": [
    {
      "id": "task-id-1",
      "description": "Prepare Q2 product launch plan",
      "dueDate": "2024-04-01T00:00:00.000Z",
      "priority": "high",
      "status": "pending"
    },
    {
      "id": "task-id-2",
      "description": "Hire 3 new engineers",
      "dueDate": null,
      "priority": "medium",
      "status": "pending"
    }
  ],
  "questions": [
    {
      "id": "question-id-1",
      "type": "true-false",
      "question": "Q4 revenue increased by 15%",
      "options": [
        {
          "id": "opt-1",
          "text": "True",
          "isCorrect": true
        },
        {
          "id": "opt-2",
          "text": "False",
          "isCorrect": false
        }
      ],
      "correctAnswer": "true",
      "explanation": "The transcript confirms a 15% revenue increase in Q4"
    },
    {
      "id": "question-id-2",
      "type": "multiple-choice",
      "question": "When is the new product launch scheduled?",
      "options": [
        {
          "id": "opt-3",
          "text": "Q1",
          "isCorrect": false
        },
        {
          "id": "opt-4",
          "text": "Q2",
          "isCorrect": true
        },
        {
          "id": "opt-5",
          "text": "Q3",
          "isCorrect": false
        }
      ],
      "correctAnswer": "Q2",
      "explanation": "The transcript mentions Q2 for the product launch"
    }
  ],
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Response Fields:**
- `id` (string): Breakdown ID
- `audioFileId` (string): Associated audio file ID
- `introduction` (string): Brief overview of the audio content
- `bulletPoints` (array): Key points mentioned in the audio
- `mainTakeaways` (array): Most important insights or conclusions
- `actionItems` (array): Tasks extracted from the audio
  - `id` (string): Task ID
  - `description` (string): Task description
  - `dueDate` (string, optional): Due date in ISO format
  - `priority` (string, optional): Priority level (`"low"`, `"medium"`, `"high"`)
  - `status` (string): Task status (`"pending"`, `"in-progress"`, `"completed"`, `"deferred"`)
- `questions` (array): Questions generated from the audio
  - `id` (string): Question ID
  - `type` (string): Question type (`"true-false"`, `"multiple-choice"`, `"short-answer"`)
  - `question` (string): Question text
  - `options` (array, optional): Answer options (for true-false and multiple-choice)
    - `id` (string): Option ID
    - `text` (string): Option text
    - `isCorrect` (boolean, optional): Whether this option is correct
  - `correctAnswer` (string, optional): Correct answer or explanation
  - `explanation` (string, optional): Explanation of the answer
- `createdAt` (string): When breakdown was created
- `updatedAt` (string): When breakdown was last updated

**Error Responses:**
- `400 Bad Request`: Missing audioFileId
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Audio file does not belong to user
- `404 Not Found`: Audio file not found or transcript not found (audio must be processed first)
- `500 Internal Server Error`: Failed to generate breakdown

**Example:**

```bash
curl -X POST http://localhost:3000/api/audio/audio-file-id/breakdown/generate \
  -H "Authorization: Bearer <jwt-token>"
```

**Note:** The audio file must be processed (transcribed) before generating a breakdown. If no transcript exists, the endpoint will return a 404 error.

---

### 6. Create Breakdown

Manually create a breakdown for an audio file. This allows you to create custom breakdowns with your own content and link existing tasks and questions.

**Endpoint:** `POST /api/audio/:audioFileId/breakdown`

**Authentication:** Required

**URL Parameters:**
- `audioFileId` (string, required): ID of the audio file

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "introduction": "This audio discusses the quarterly business review meeting...",
  "bulletPoints": [
    "Q4 revenue increased by 15%",
    "New product launch scheduled for Q2"
  ],
  "mainTakeaways": [
    "Strong financial performance in Q4",
    "Focus on product innovation"
  ],
  "actionItemIds": ["task-id-1", "task-id-2"],
  "questionIds": ["question-id-1", "question-id-2"]
}
```

**Request Fields:**
- `introduction` (string, required): Brief overview of the audio content
- `bulletPoints` (array, optional): Key points mentioned in the audio
- `mainTakeaways` (array, optional): Most important insights or conclusions
- `actionItemIds` (array, optional): IDs of existing tasks to link to this breakdown
- `questionIds` (array, optional): IDs of existing questions to link to this breakdown

**Response:** `201 Created`

Returns the same structure as the Generate Breakdown endpoint.

**Error Responses:**
- `400 Bad Request`: Missing required fields (introduction)
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Audio file does not belong to user, or breakdown already exists
- `404 Not Found`: Audio file not found, or task/question IDs not found
- `500 Internal Server Error`: Failed to create breakdown

**Example:**

```bash
curl -X POST http://localhost:3000/api/audio/audio-file-id/breakdown \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "introduction": "This audio discusses...",
    "bulletPoints": ["Point 1", "Point 2"],
    "mainTakeaways": ["Takeaway 1"],
    "actionItemIds": ["task-id-1"],
    "questionIds": ["question-id-1"]
  }'
```

---

### 7. Get Breakdown

Retrieve a breakdown by its ID.

**Endpoint:** `GET /api/audio/breakdown/:breakdownId`

**Authentication:** Required

**URL Parameters:**
- `breakdownId` (string, required): Breakdown ID

**Response:** `200 OK`

Returns the same structure as the Generate Breakdown endpoint.

**Error Responses:**
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Breakdown does not belong to user
- `404 Not Found`: Breakdown not found
- `500 Internal Server Error`: Failed to get breakdown

**Example:**

```bash
curl http://localhost:3000/api/audio/breakdown/breakdown-id \
  -H "Authorization: Bearer <jwt-token>"
```

---

### 8. Update Breakdown

Update an existing breakdown. You can update any field, and only the provided fields will be updated (partial update).

**Endpoint:** `PUT /api/audio/breakdown/:breakdownId`

**Authentication:** Required

**URL Parameters:**
- `breakdownId` (string, required): Breakdown ID

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "introduction": "Updated introduction text",
  "bulletPoints": ["Updated point 1", "Updated point 2"],
  "mainTakeaways": ["Updated takeaway"],
  "actionItemIds": ["new-task-id-1"],
  "questionIds": ["new-question-id-1"]
}
```

**Request Fields:**
- `introduction` (string, optional): Updated introduction
- `bulletPoints` (array, optional): Updated bullet points
- `mainTakeaways` (array, optional): Updated main takeaways
- `actionItemIds` (array, optional): Updated list of task IDs to link
- `questionIds` (array, optional): Updated list of question IDs to link

**Response:** `200 OK`

Returns the updated breakdown with the same structure as the Generate Breakdown endpoint.

**Error Responses:**
- `400 Bad Request`: Invalid breakdownId
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Breakdown does not belong to user, or task/question IDs do not belong to user
- `404 Not Found`: Breakdown not found, or task/question IDs not found
- `500 Internal Server Error`: Failed to update breakdown

**Example:**

```bash
curl -X PUT http://localhost:3000/api/audio/breakdown/breakdown-id \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "introduction": "Updated introduction",
    "bulletPoints": ["New point 1", "New point 2"]
  }'
```

---

### 9. Delete Breakdown

Delete a breakdown by its ID.

**Endpoint:** `DELETE /api/audio/breakdown/:breakdownId`

**Authentication:** Required

**URL Parameters:**
- `breakdownId` (string, required): Breakdown ID

**Response:** `204 No Content`

**Error Responses:**
- `400 Bad Request`: Invalid breakdownId
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Breakdown does not belong to user
- `404 Not Found`: Breakdown not found
- `500 Internal Server Error`: Failed to delete breakdown

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/audio/breakdown/breakdown-id \
  -H "Authorization: Bearer <jwt-token>"
```

---

## Health Check

**Endpoint:** `GET /health`

**Authentication:** Not required

**Response:** `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Example:**

```bash
curl http://localhost:3000/health
```

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": "Error message description"
}
```

## Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `202 Accepted`: Request accepted for processing
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Authentication required or invalid
- `403 Forbidden`: Access denied
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## Notes

- All timestamps are in ISO 8601 format (UTC)
- File size limits: Maximum 100MB per audio file
- Vector store: Default is MongoDB vector store (`"mongodb"`). Also supports OpenAI Vector Store API (`"openai"`) and in-memory storage (`"in-memory"`)
- Processing jobs run asynchronously; check job status separately if needed
- Chat responses are streamed in real-time using Server-Sent Events
- Breakdown generation requires the audio file to be processed (transcribed) first
- True/False questions will have `isCorrect` properly set for both "True" and "False" options
- CDN URLs: If `CDN_URL` is configured in environment variables, uploaded audio files will include a `cdnUrl` field for playback

