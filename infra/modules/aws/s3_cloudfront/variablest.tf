variable "bucket_id" {
  type = string
}

variable "bucket_arn" {
  type = string
}

variable "s3_bucket_domain" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "default_root_object" {
  type    = string
  default = "index.html"
}

variable "additional_policy_statements" {
  type        = list(any)
  description = "Additional policy statements to merge with CloudFront bucket policy"
  default     = []
}
