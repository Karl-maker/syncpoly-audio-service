


############################
# Create s3 and get CDN domain for usage with s3
############################

module "s3" {
  source = "../modules/aws/s3"
  bucket_name = "syncpoly-transcibe-static-assets"
  
  # Allow public access through bucket policies (needed for presigned URLs and CDN)
  block_public_policy = false
  block_public_acls = true
  ignore_public_acls = true
  restrict_public_buckets = true
  
  # Bucket policy will be managed by CloudFront module to merge all statements
  bucket_policy = null
  
  # CORS configuration
  cors_rules = [
    {
      allowed_headers = ["*"]
      allowed_methods = ["GET", "PUT", "POST", "HEAD"]
      allowed_origins = ["https://transcribe.syncpoly.com"]
      expose_headers  = ["ETag", "Content-Length"]
      max_age_seconds = 3000
    }
  ]
}

############################
# Private S3 bucket for YouTube cookies
############################

module "s3_youtube_cookies" {
  source = "../modules/aws/s3"
  bucket_name = "syncpoly-youtube-cookies"
  
  # Private bucket - block all public access
  block_public_policy = true
  block_public_acls = true
  ignore_public_acls = true
  restrict_public_buckets = true
  
  # No bucket policy needed (private bucket)
  bucket_policy = null
  
  # No CORS needed (private bucket)
  cors_rules = []
}

module "cdn" {
  source           = "../modules/aws/s3_cloudfront"
  bucket_id        = module.s3.bucket_id
  bucket_arn       = module.s3.bucket_arn
  s3_bucket_domain = module.s3.bucket_domain
  bucket_name      = "syncpoly-transcibe-static-assets"
  
  # Include presigned URL upload policy statement
  additional_policy_statements = [
    {
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
    }
  ]
}