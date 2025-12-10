locals {
  docker_cloud_init = <<EOF
#cloud-config
package_update: true
packages:
  - docker.io

runcmd:
  - [ sh, -c, "usermod -aG docker ubuntu || true" ]
  - [ systemctl, enable, docker ]
  - [ systemctl, start, docker ]
EOF
}

resource "oci_core_instance" "vm" {
  compartment_id      = var.compartment_ocid
  availability_domain = var.availability_domain
  shape               = var.shape
  display_name        = var.display_name

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = var.image_id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id       = var.subnet_id
    assign_public_ip = true
  }

  metadata = {
    ssh_authorized_keys = join("\n", var.ssh_public_keys)
    user_data           = base64encode(local.docker_cloud_init)
  }
}
