terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 1.25.0"
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


variable "tenancy_ocid"      { type = string }
variable "user_ocid"         { type = string }
variable "fingerprint"       { type = string }
variable "private_key_path"  { type = string }
variable "region"            { type = string }
variable "compartment_ocid"  { type = string }

variable "domain" {
  type        = string
  default     = "syncpoly.com"
}

variable "subdomain" {
  type        = string
  default     = "transcript"
}

variable "instance_shape" {
  type    = string
  default = "VM.Standard.A1.Flex"
}

variable "static_s3_bucket_name" {
  type        = string
  description = "Name of the S3 bucket for static assets"
}

variable "aws_region" {
  type        = string
  description = "AWS region for S3 and CloudFront resources"
  default     = "us-east-1"
}

variable "mongodbatlas_public_key" {
    type = string
}

variable "mongodbatlas_private_key" {
    type = string
}

variable "mongodbatlas_org_id" {
    type = string
}

variable "mongodbatlas_db_user" {
    type = string
}

variable "mongodbatlas_db_password" {
    type = string
}