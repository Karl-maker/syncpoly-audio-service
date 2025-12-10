resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${var.bucket_name}-oac"
  description                       = "OAC for ${var.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  comment             = "${var.bucket_name} CDN"
  default_root_object = var.default_root_object

  origin {
    domain_name              = var.s3_bucket_domain
    origin_id                = "s3origin-${var.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3origin-${var.bucket_name}"

    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
    origin_request_policy_id   = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf" # Managed-S3Origin
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Allow CloudFront OAC to read bucket
resource "aws_s3_bucket_policy" "allow_cf" {
  bucket = var.bucket_id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = ["s3:GetObject"]
        Resource = "${var.bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn
          }
        }
      }
    ]
  })
}
