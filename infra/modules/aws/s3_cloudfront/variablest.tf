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
