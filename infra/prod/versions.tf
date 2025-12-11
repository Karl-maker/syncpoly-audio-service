terraform {
  required_version = ">= 1.5.0"

  required_providers {

    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "syncpoly-terraform-state"
    key            = "transcript-service/terraform.tfstate"
    region         = "us-east-1"

    # Enable for multi-user protection (recommended)
    dynamodb_table = "syncpoly-terraform-locks"

    # Optional: If using IAM roles, remove these
    encrypt        = true
  }
}

