// Test the deployed Lambda function directly (bypasses Function URL auth)
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const PLATFORM = "750294427884";
const sts = new STSClient({ region: "us-east-1" });
const r = await sts.send(new AssumeRoleCommand({
  RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
  RoleSessionName: "test-lambda",
}));
const c = r.Credentials;

const lambda = new LambdaClient({
  region: "us-east-1",
  credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
});

const payload = { rawPath: "/health", requestContext: { http: { method: "GET" } } };
const res = await lambda.send(new InvokeCommand({
  FunctionName: "ShieldSyncEngine",
  Payload: JSON.stringify(payload),
}));

const body = JSON.parse(Buffer.from(res.Payload).toString());
console.log("Status:", res.StatusCode);
console.log("FunctionError:", res.FunctionError);
console.log("Response:", JSON.stringify(body, null, 2));
