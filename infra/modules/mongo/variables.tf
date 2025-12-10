variable "mongodbatlas_public_key" {
  description = "MongoDB Atlas API public key"
}

variable "mongodbatlas_private_key" {
  description = "MongoDB Atlas API private key"
  sensitive   = true
}

variable "org_id" {
  description = "MongoDB Atlas organization ID"
}

variable "project_name" {
  description = "Project name to create in Atlas"
}

variable "cluster_name" {
  description = "Cluster name to create in Atlas"
  default     = "main-cluster"
}

variable "provider_region" {
  description = "AWS region for cluster"
  default     = "US_EAST_1"
}

variable "instance_size" {
  description = "Cluster size (e.g. M10, M20)"
  default     = "M2"
}

variable "db_user" {
  description = "Database username to create"
}

variable "db_password" {
  description = "Database user password"
  sensitive   = true
}

variable "database_name" {
  description = "Database name"
  default     = "appdb"
}
