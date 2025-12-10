# === 1. Create MongoDB Atlas Project ===
resource "mongodbatlas_project" "project" {
  name   = var.project_name
  org_id = var.org_id

  # Optional: you can add alert settings or teams here later
}

# === 2. Create a Cluster ===
resource "mongodbatlas_cluster" "cluster" {
  project_id              = mongodbatlas_project.project.id
  name                    = var.cluster_name
  cluster_type            = "REPLICASET"
  provider_name           = "AWS"
  provider_region_name    = var.provider_region
  provider_instance_size_name = var.instance_size
}


# === 3. Create a Database User ===
resource "mongodbatlas_database_user" "user" {
  project_id         = mongodbatlas_project.project.id
  username           = var.db_user
  password           = var.db_password
  auth_database_name = "admin"

  roles {
    role_name     = "readWrite"
    database_name = var.database_name
  }

}

# === 4. Backup Configuration (Correct for v1.14) ===
# resource "mongodbatlas_cloud_backup_schedule" "schedule" {
#   project_id   = mongodbatlas_project.project.id
#   cluster_name = mongodbatlas_cluster.cluster.name

#   reference_hour_of_day    = 0
#   reference_minute_of_hour = 0
#   restore_window_days      = 7

#   depends_on = [mongodbatlas_cluster.cluster]
# }
