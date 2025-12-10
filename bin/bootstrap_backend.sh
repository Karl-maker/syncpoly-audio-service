#!/bin/bash
set -e

# Read environment variables
: "${BUCKET:?Environment variable BUCKET not set}"
: "${TABLE:?Environment variable TABLE not set}"
: "${AWS_REGION:?Environment variable AWS_REGION not set}"

BUCKET="$BUCKET"
TABLE="$TABLE"
REGION="$AWS_REGION"

# echo "Using bucket: $BUCKET"
# echo "Using DynamoDB table: $TABLE"
# echo "Using AWS region: $REGION"

# Configure AWS CLI region
aws configure set region "$REGION"

# ---------------------------
# Check S3 bucket
# ---------------------------
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Creating S3 bucket $BUCKET in region $REGION..."
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    $( [[ "$REGION" != "us-east-1" ]] && echo "--create-bucket-configuration LocationConstraint=$REGION" )

  # Block public access
  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  # Enable versioning
  aws s3api put-bucket-versioning \
    --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled

  # Enable server-side encryption (AES256)
  aws s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }]
    }'

else
  echo "S3 bucket $BUCKET already exists, skipping creation."
fi

# ---------------------------
# Check DynamoDB table
# ---------------------------
if ! aws dynamodb describe-table --table-name "$TABLE" 2>/dev/null; then
  echo "Creating DynamoDB table $TABLE in region $REGION..."
  aws dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION"
else
  echo "DynamoDB table $TABLE already exists, skipping creation."
fi

# # ---------------------------
# # Initialize Terraform backend
# # ---------------------------
# echo "Initializing Terraform..."
# terraform init -backend-config="bucket=$BUCKET" \
#                -backend-config="dynamodb_table=$TABLE" \
#                -backend-config="region=$REGION"
