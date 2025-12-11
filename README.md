# Audio Service - Infrastructure & Setup Guide

This document explains the infrastructure setup, S3 configuration, presigned URL uploads, and YouTube cookies management for the Audio Service.

## Table of Contents

- [Overview](#overview)
- [Infrastructure (Terraform)](#infrastructure-terraform)
- [S3 Buckets](#s3-buckets)
- [Presigned URL Uploads (v2)](#presigned-url-uploads-v2)
- [YouTube Cookies Management](#youtube-cookies-management)
- [CI/CD Workflow](#cicd-workflow)
- [Configuration](#configuration)

## Overview

The Audio Service uses AWS S3 for file storage, Terraform for infrastructure provisioning, and supports two upload methods:
- **v1**: Direct file uploads through the API (multipart/form-data)
- **v2**: Presigned URL uploads (client uploads directly to S3)

The service also manages YouTube cookies in S3 for accessing age-restricted or private content via `yt-dlp`.

## Infrastructure (Terraform)

### Structure

The infrastructure is managed using Terraform with the following structure:

```
infra/
├── modules/
│   └── aws/
│       ├── s3/              # S3 bucket module
│       └── s3_cloudfront/    # CloudFront CDN module
└── prod/
    ├── main.tf              # Main configuration
    ├── providers.tf         # Provider configuration
    ├── versions.tf          # Version constraints
    └── outputs.tf            # Output values
```

### Provisioning

Infrastructure is provisioned via GitHub Actions workflow (`.github/workflows/provision.yml`). The workflow:

1. Initializes Terraform with S3 backend for state management
2. Validates the configuration
3. Plans and applies changes
4. Outputs the CDN URL for use in other workflows

### Required Secrets

The following GitHub secrets are required for provisioning:

- `AWS_ACCESS_KEY_ID` - AWS access key for Terraform operations
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_REGION` - AWS region (e.g., `us-east-1`)
- `AWS_STATE_BUCKET` - S3 bucket for Terraform state
- `AWS_LOCK_TABLE` - DynamoDB table for state locking
- `AWS_STATE_BUCKET_KEY` - Key path for Terraform state
- `STATIC_S3_BUCKET_NAME` - Name of the static assets S3 bucket

## S3 Buckets

### 1. Static Assets Bucket (`syncpoly-transcibe-static-assets`)

This bucket stores audio files, video files, and processed transcripts. It's configured with:

- **Public Access**: Blocked for ACLs, but allows public access through bucket policies (needed for presigned URLs)
- **Bucket Policy**: Allows `s3:PutObject` with `x-amz-acl: private` condition for presigned URL uploads
- **CORS Configuration**: 
  - Allowed origins: `transcribe.syncpoly.com`
  - Allowed methods: `GET`, `PUT`, `POST`, `HEAD`
  - Allowed headers: `*`
  - Exposed headers: `ETag`, `Content-Length`
  - Max age: 3000 seconds
- **CloudFront CDN**: Configured for content delivery
- **Versioning**: Enabled
- **Encryption**: AES256 server-side encryption

**Terraform Configuration:**
```hcl
module "s3" {
  source = "../modules/aws/s3"
  bucket_name = "syncpoly-transcibe-static-assets"
  
  block_public_policy = false  # Allow public access through policies
  block_public_acls = true
  ignore_public_acls = true
  restrict_public_buckets = true
  
  bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowPresignedUrlUploads"
      Effect = "Allow"
      Principal = "*"
      Action   = "s3:PutObject"
      Resource = "arn:aws:s3:::syncpoly-transcibe-static-assets/*"
      Condition = {
        StringEquals = {
          "s3:x-amz-acl" = "private"
        }
      }
    }]
  })
  
  cors_rules = [{
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = ["transcribe.syncpoly.com"]
    expose_headers  = ["ETag", "Content-Length"]
    max_age_seconds = 3000
  }]
}
```

### 2. YouTube Cookies Bucket (`syncpoly-youtube-cookies`)

This private bucket stores YouTube cookies for `yt-dlp` to access age-restricted or private content.

- **Public Access**: Fully blocked (all settings enabled)
- **No Bucket Policy**: Private bucket, no public access needed
- **No CORS**: Not needed for private bucket
- **No CDN**: Not needed for internal use
- **Versioning**: Enabled
- **Encryption**: AES256 server-side encryption

**Terraform Configuration:**
```hcl
module "s3_youtube_cookies" {
  source = "../modules/aws/s3"
  bucket_name = "syncpoly-youtube-cookies"
  
  block_public_policy = true
  block_public_acls = true
  ignore_public_acls = true
  restrict_public_buckets = true
  
  bucket_policy = null
  cors_rules = []
}
```

**Key**: The cookies file must be stored with the key `cookies.txt` in this bucket.

## Presigned URL Uploads (v2)

The v2 upload endpoints allow clients to upload files directly to S3, reducing server load and improving upload performance for large files.

### Flow

1. **Initialize Upload** (`POST /api/audio/v2/upload/init`)
   - Client sends: `filename`, `contentType`, `fileSize`
   - Server creates an `UploadJob` with status `pending`
   - Server generates a presigned PUT URL (expires in 1 hour)
   - Server returns: `jobId`, `uploadUrl`, `s3Key`, `s3Bucket`, `expiresIn`

2. **Client Uploads to S3**
   - Client uploads file directly to the presigned URL using HTTP PUT
   - Must include header: `x-amz-acl: private`
   - Upload happens directly from client to S3 (bypasses server)

3. **Complete Upload** (`POST /api/audio/v2/upload/audio/complete` or `/v2/upload/video/complete`)
   - Client sends: `jobId`
   - Server validates the upload job and checks if file exists in S3
   - Server processes the file asynchronously (chunking, duration detection, etc.)
   - Server returns `202 Accepted` immediately
   - Processing continues in background

### Example Usage

```typescript
// 1. Initialize upload
const initResponse = await fetch('/api/audio/v2/upload/init', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    filename: 'audio.mp3',
    contentType: 'audio/mpeg',
    fileSize: 1024000
  })
});

const { jobId, uploadUrl, s3Key, s3Bucket, expiresIn } = await initResponse.json();

// 2. Upload file directly to S3
const file = document.getElementById('fileInput').files[0];
await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'audio/mpeg',
    'x-amz-acl': 'private'
  },
  body: file
});

// 3. Complete upload
const completeResponse = await fetch('/api/audio/v2/upload/audio/complete', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ jobId })
});

const { jobId: completedJobId, status, message } = await completeResponse.json();

// 4. Poll for progress
const progressResponse = await fetch(`/api/audio/upload/${completedJobId}/progress`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Benefits

- **Reduced Server Load**: Files bypass the application server
- **Better Performance**: Direct upload to S3 is faster
- **Scalability**: No server bandwidth limitations
- **Cost Efficiency**: Reduced server compute and bandwidth costs

### Security

- Presigned URLs expire after 1 hour
- URLs are scoped to specific S3 keys
- Bucket policy requires `x-amz-acl: private` header
- All uploads are authenticated via JWT before URL generation

## YouTube Cookies Management

The service uses `yt-dlp` to download videos from YouTube and other platforms. To access age-restricted or private content, cookies are required.

### How It Works

1. **Cookie Storage**: YouTube cookies are stored in S3 bucket `syncpoly-youtube-cookies` with key `cookies.txt`

2. **Cookie Retrieval**: When downloading a video:
   - Service first checks S3 for `cookies.txt`
   - If found, downloads it to a temporary file
   - Falls back to local file system (`/app/cookies/youtube_cookies.txt`) if S3 doesn't have it
   - Uses cookies with `yt-dlp --cookies` flag
   - Cleans up temporary file after download

3. **Implementation**: The `VideoDownloadService` class handles this automatically:
   ```typescript
   // Service checks S3 first, then local filesystem
   const cookiesPath = await this.getCookiesFilePath();
   if (cookiesPath) {
     // Use cookies with yt-dlp
     const cookieArgs = ["--cookies", cookiesPath];
   }
   ```

### Uploading Cookies to S3

To upload or update cookies:

```bash
# Export cookies from browser (using browser extension like "Get cookies.txt LOCALLY")
# Then upload to S3:

aws s3 cp cookies.txt s3://syncpoly-youtube-cookies/cookies.txt
```

Or using the AWS Console:
1. Navigate to S3 bucket `syncpoly-youtube-cookies`
2. Upload file with key `cookies.txt`

### Cookie Format

Cookies must be in Netscape format (compatible with `yt-dlp`):

```
# Netscape HTTP Cookie File
.youtube.com	TRUE	/	FALSE	1735689600	VISITOR_INFO1_LIVE	abc123...
.youtube.com	TRUE	/	FALSE	1735689600	YSC	def456...
```

### Browser Extensions

Recommended browser extensions for exporting cookies:
- **Get cookies.txt LOCALLY** (Chrome/Edge)
- **cookies.txt** (Firefox)

## CI/CD Workflow

### Build Workflow (`.github/workflows/build.yml`)

1. **Build Job**:
   - Builds Docker image
   - Pushes to GitHub Container Registry
   - Tags based on branch/PR/semver

2. **Provision Job**:
   - Calls `provision.yml` workflow
   - Provisions infrastructure using Terraform
   - Outputs CDN URL

### Provision Workflow (`.github/workflows/provision.yml`)

1. **Setup**:
   - Configures AWS credentials
   - Installs Terraform
   - Bootstraps S3 backend (if needed)

2. **Terraform Operations**:
   - `terraform init` - Initialize with S3 backend
   - `terraform validate` - Validate configuration
   - `terraform plan` - Plan changes
   - `terraform apply` - Apply changes

3. **Outputs**:
   - Extracts `cdn_url` from Terraform outputs
   - Makes it available to other workflows

## Configuration

### Environment Variables

Required environment variables for the application:

```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET=syncpoly-transcibe-static-assets
CDN_URL=https://your-cloudfront-url.cloudfront.net

# Optional S3 Configuration
S3_ENDPOINT=                    # For S3-compatible services (e.g., MinIO)
S3_FORCE_PATH_STYLE=false       # Use path-style addressing

# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=audio-service

# JWT
JWT_SECRET=your-secret-key

# OpenAI (for transcription/embeddings)
OPENAI_API_KEY=your-api-key
```

### Terraform Variables

Terraform variables are passed via GitHub secrets or environment variables:

- `static_s3_bucket_name` - Name of the static assets bucket (from `STATIC_S3_BUCKET_NAME` secret)

### S3 Bucket Policy Explanation

The bucket policy for presigned URLs works as follows:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowPresignedUrlUploads",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::syncpoly-transcibe-static-assets/*",
    "Condition": {
      "StringEquals": {
        "s3:x-amz-acl": "private"
      }
    }
  }]
}
```

- **Principal: "*"**: Allows any principal (presigned URLs are signed, so this is safe)
- **Action: s3:PutObject**: Only allows uploads, not reads
- **Condition**: Requires `x-amz-acl: private` header, ensuring files are private even though the policy allows uploads

## Troubleshooting

### Presigned URL Uploads Failing

1. **Check CORS**: Ensure your origin (`transcribe.syncpoly.com`) is in the CORS allowed origins
2. **Check Bucket Policy**: Verify the bucket policy allows `s3:PutObject` with the condition
3. **Check Headers**: Ensure `x-amz-acl: private` header is included in the PUT request
4. **Check Expiration**: Presigned URLs expire after 1 hour

### YouTube Downloads Failing

1. **Check S3 Cookies**: Verify `cookies.txt` exists in `syncpoly-youtube-cookies` bucket
2. **Check Cookie Format**: Ensure cookies are in Netscape format
3. **Check Cookie Expiry**: Cookies may have expired - update them
4. **Check Local Fallback**: Service will fall back to `/app/cookies/youtube_cookies.txt` if S3 doesn't have cookies

### Terraform Provisioning Issues

1. **Check Secrets**: Ensure all required GitHub secrets are set
2. **Check AWS Credentials**: Verify AWS credentials have necessary permissions
3. **Check State Lock**: If apply fails, check DynamoDB for stale locks
4. **Check Backend**: Ensure S3 backend bucket exists and is accessible

## Additional Resources

- [AWS S3 Presigned URLs Documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [Terraform AWS Provider Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)

