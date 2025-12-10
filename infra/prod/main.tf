
############################
# Network (from remote state)
############################

data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "syncpoly-terraform-state"
    key    = "network/terraform.tfstate"
    region = "us-east-1"

    # Only include this if the S3 backend uses access keys
    # access_key = var.aws_access_key
    # secret_key = var.aws_secret_key
  }
}

############################
# Create s3 and get CDN domain for usage with s3
############################

module "s3" {
  source = "../modules/aws/s3"
  bucket_name = var.static_s3_bucket_name
}

module "cdn" {
  source           = "../modules/aws/s3_cloudfront"
  bucket_id        = module.s3.bucket_id
  bucket_arn       = module.s3.bucket_arn
  s3_bucket_domain = module.s3.bucket_domain
  bucket_name      = "syncpoly-transcibe-static-assets"
}