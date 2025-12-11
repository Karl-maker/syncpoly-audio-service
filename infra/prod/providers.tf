
provider "aws" {
  region = var.aws_region
  # AWS credentials are provided via environment variables:
  # AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
}
