# Merchant Auth deployment paths

```text
MERCHANT_AUTH_DEPLOYMENT_SOURCE=functions/privlan-merchant-api/index.ts
MERCHANT_AUTH_V13_SHA256=b3b2664b0e39133083495c27de91be4a6ce71aa10b3f9617664d1d0321880900
EDGE_FUNCTION_NAME=privlan-merchant-api
MERCHANT_AUTH_ROLLBACK_SOURCE=archive/v12/index.ts
MERCHANT_AUTH_V12_ROLLBACK_SHA256=0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55
```

Merchant Auth deployment source:
`functions/privlan-merchant-api/index.ts`

Rollback source:
`archive/v12/index.ts`

The deployment candidate is the reviewed Git revision containing the V13 source. The V12 archive is retained for byte-verified rollback.
