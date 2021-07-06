const core = require("@actions/core");
const tmp = require("tmp");
const fs = require("fs");

try {
  const serviceName = core.getInput("service-name", { required: true });
  const image = core.getInput("image", { required: true });
  const environment = core.getInput("environment", { required: false }) || "[]";
  const deploymentEnvironment = core.getInput("deployment-environment", { required: true });
  const region = core.getInput("region", { required: false }) || "eu-west-2";
  const cpu = core.getInput("cpu", { required: false }) || "256";
  const memory = core.getInput("memory", { required: false }) || "1024";
  const taskRoleArn = core.getInput("task-role-arn", { required: true });
  const executionRoleArn = core.getInput("execution-role-arn", { required: true });

  const environmentParsed = JSON.parse(environment); // i.e. '[ { "name": "PORT", "value" : "80" } ]'

  // Define task
  const task = {
    containerDefinitions: [
      {
        name: `${serviceName}-service-container`,
        image,
        cpu: 0,
        environment: environmentParsed,
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": `/ecs/${deploymentEnvironment}/${serviceName}-service-task`,
            "awslogs-region": region,
            "awslogs-stream-prefix": "ecs",
          },
        },
        portMappings: [
          {
            hostPort: 80,
            protocol: "tcp",
            containerPort: 80,
          },
        ],
        dependsOn: [
          {
            containerName: "envoy",
            condition: "HEALTHY",
          },
          {
            containerName: "xray",
            condition: "START",
          },
        ],
        ulimits: [
          {
            name: "nofile",
            softLimit: 65535,
            hardLimit: 65535,
          },
        ],
      },
      {
        name: "envoy",
        environment: [
          {
            name: "APPMESH_VIRTUAL_NODE_NAME",
            value: `mesh/${deploymentEnvironment}-mesh/virtualNode/${serviceName}`,
          },
        ],
        image: `840364872350.dkr.ecr.${region}.amazonaws.com/aws-appmesh-envoy:v1.18.3.0-prod`,
        healthCheck: {
          retries: 3,
          command: ["CMD-SHELL", "curl -s http://localhost:9901/server_info | grep state | grep -q LIVE"],
          timeout: 2,
          interval: 5,
          startPeriod: 10,
        },
        user: "1337",
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": `/ecs/${deploymentEnvironment}/${serviceName}-service-task/envoy`,
            "awslogs-region": region,
            "awslogs-stream-prefix": "ecs",
          },
        },
        ulimits: [
          {
            name: "nofile",
            softLimit: 65535,
            hardLimit: 65535,
          },
        ],
      },
      {
        name: "xray",
        image: "amazon/aws-xray-daemon",
        portMappings: [
          {
            containerPort: 2000,
            protocol: "udp",
          },
        ],
        user: "1337",
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": `/ecs/${deploymentEnvironment}/${serviceName}-service-task/xray`,
            "awslogs-region": region,
            "awslogs-stream-prefix": "ecs",
          },
        },
      },
    ],
    family: `${deploymentEnvironment}-${serviceName}-service-task`,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu,
    memory,
    taskRoleArn,
    executionRoleArn,
    proxyConfiguration: {
      type: "APPMESH",
      containerName: "envoy",
      properties: [
        {
          name: "ProxyIngressPort",
          value: "15000",
        },
        {
          name: "AppPorts",
          value: "80",
        },
        {
          name: "EgressIgnoredIPs",
          value: "169.254.170.2,169.254.169.254",
        },
        {
          name: "IgnoredGID",
          value: "",
        },
        {
          name: "EgressIgnoredPorts",
          value: "",
        },
        {
          name: "IgnoredUID",
          value: "1337",
        },
        {
          name: "ProxyEgressPort",
          value: "15001",
        },
      ],
    },
  };

  // Write out a new task definition file
  const updatedTaskDefFile = tmp.fileSync({
    tmpdir: process.env.RUNNER_TEMP,
    prefix: "task-definition-",
    postfix: ".json",
    keep: true,
    discardDescriptor: true,
  });
  const taskDefContents = JSON.stringify(task, null, 2);
  fs.writeFileSync(updatedTaskDefFile.name, taskDefContents);
  core.setOutput("task-definition", updatedTaskDefFile.name);
} catch (error) {
  core.setFailed(error.message);
}
