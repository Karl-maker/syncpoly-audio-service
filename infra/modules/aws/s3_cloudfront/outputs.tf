output "cdn_domain" {
  value = aws_cloudfront_distribution.cdn.domain_name
}

output "cdn_id" {
  value = aws_cloudfront_distribution.cdn.id
}

output "cdn_arn" {
  value = aws_cloudfront_distribution.cdn.arn
}
