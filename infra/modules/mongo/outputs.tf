
output "project_id" {
  value = mongodbatlas_project.project.id
}

output "cluster_name" {
  value = mongodbatlas_cluster.cluster.name
}

output "connection_string" {
  value = "mongodb+srv://${var.db_user}:${var.db_password}@${replace(mongodbatlas_cluster.cluster.connection_strings[0].standard_srv, "mongodb+srv://", "")}/${var.database_name}?retryWrites=true&w=majority"
  sensitive = true
}

output "database_user" {
  value = mongodbatlas_database_user.user.username
}