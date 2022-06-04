import { EnclaveContext, ServiceID, ContainerConfig, ContainerConfigBuilder, ServiceContext, PortSpec, PortProtocol } from "kurtosis-core-api-lib";
import log = require("loglevel");
import { Result, ok, err } from "neverthrow";
import { ContainerConfigSupplier } from "../near_module";
import { waitForPortAvailability } from "../service_port_availability_checker";
import { getPrivateAndPublicUrlsForPortId, ServiceUrl } from "../service_url";

const SERVICE_ID: ServiceID = "explorer-frontend";
const PORT_ID = "http";
const PORT_PROTOCOL = "http";
const IMAGE: string = "kurtosistech/near-explorer_frontend:924c832";
const PRIVATE_PORT_NUM: number = 3000;
const PUBLIC_PORT_NUM: number = 8331;
const PRIVATE_PORT_SPEC = new PortSpec(PRIVATE_PORT_NUM, PortProtocol.TCP);
const PUBLIC_PORT_SPEC = new PortSpec(PUBLIC_PORT_NUM, PortProtocol.TCP);

// TODO REPLACE THIS WITH DYNAMIC VALUES
const NETWORKS_CONFIG_JSON = `
{
    "mainnet": {
      "explorerLink": "https://explorer.near.org/",
      "aliases": ["explorer.near.org", "explorer.mainnet.near.org", "explorer.nearprotocol.com", "explorer.mainnet.nearprotocol.com"],
      "nearWalletProfilePrefix": "https://wallet.near.org/profile"
    },
    "testnet": {
      "explorerLink": "https://explorer.testnet.near.org/",
      "aliases": ["explorer.testnet.near.org", "explorer.testnet.nearprotocol.com"],
      "nearWalletProfilePrefix": "https://wallet.testnet.near.org/profile"
    },
    "guildnet": {
      "explorerLink": "https://explorer.guildnet.near.org/",
      "aliases": ["explorer.guildnet.near.org"],
      "nearWalletProfilePrefix": "https://wallet.openshards.io/profile"
    },
    "localnet": {
      "explorerLink": "http://127.0.0.1:8331",
      "aliases": [],
      "nearWalletProfilePrefix": "http://127.0.0.1:8334/profile"
    }
  }
`

const MILLIS_BETWEEN_PORT_AVAILABILITY_RETRIES: number = 500;
const PORT_AVAILABILITY_TIMEOUT_MILLIS:  number = 5_000;

export class ExplorerFrontendInfo {
    constructor (
        public readonly publicUrl: ServiceUrl,
    ) {}
}

export async function addExplorerFrontendService(
    enclaveCtx: EnclaveContext, 
    // The IP address to use for connecting to the backend services
    backendPrivateUrl: ServiceUrl,
    backendPublicUrl: ServiceUrl,
): Promise<Result<ExplorerFrontendInfo, Error>> {
    log.info(`Adding explorer frontend service running on port '${PRIVATE_PORT_NUM}'`);
    const usedPorts: Map<string, PortSpec> = new Map();
    usedPorts.set(PORT_ID, PRIVATE_PORT_SPEC);

    const publicPorts: Map<string, PortSpec> = new Map();
    publicPorts.set(PORT_ID, PUBLIC_PORT_SPEC);

    const backendPrivateIp = backendPrivateUrl.ipAddress
    const backendPublicIp = backendPublicUrl.ipAddress
    const envVars: Map<string, string> = new Map([
        // TODO MAKE THIS MATCH BACKEND???
        ["NEAR_EXPLORER_CONFIG__NETWORK_NAME", "localnet"],
        ["NEAR_EXPLORER_CONFIG__NETWORKS", NETWORKS_CONFIG_JSON],

        ["PORT", PRIVATE_PORT_NUM.toString()],

        ["NEAR_EXPLORER_CONFIG__BACKEND_SSR__HOSTS__MAINNET", backendPrivateIp],
        ["NEAR_EXPLORER_CONFIG__BACKEND_SSR__HOSTS__TESTNET", backendPrivateIp],
        ["NEAR_EXPLORER_CONFIG__BACKEND_SSR__HOSTS__GUILDNET", backendPrivateIp],
        ["NEAR_EXPLORER_CONFIG__BACKEND_SSR__PORT", backendPrivateUrl.portNumber.toString()],
        ["NEAR_EXPLORER_CONFIG__BACKEND_SSR__SECURE", "false"],

        ["NEAR_EXPLORER_CONFIG__BACKEND__HOSTS__MAINNET", backendPublicIp],
        ["NEAR_EXPLORER_CONFIG__BACKEND__HOSTS__TESTNET", backendPublicIp],
        ["NEAR_EXPLORER_CONFIG__BACKEND__HOSTS__GUILDNET", backendPublicIp],
        ["NEAR_EXPLORER_CONFIG__BACKEND__PORT", backendPublicUrl.portNumber.toString()],
        ["NEAR_EXPLORER_CONFIG__BACKEND__SECURE", "false"],
    ]);

    const containerConfigSupplier: ContainerConfigSupplier = (ipAddr: string): Result<ContainerConfig, Error> => {
        const result: ContainerConfig = new ContainerConfigBuilder(
            IMAGE,
        ).withUsedPorts(
            usedPorts,
        ).withPublicPorts(
            publicPorts,
        ).withEnvironmentVariableOverrides(
                envVars
        ).build();
        return ok(result);
    }
    
    const addServiceResult: Result<ServiceContext, Error> = await enclaveCtx.addService(SERVICE_ID, containerConfigSupplier);
    if (addServiceResult.isErr()) {
        return err(addServiceResult.error);
    }
    const serviceCtx = addServiceResult.value;

    const waitForPortAvailabilityResult = await waitForPortAvailability(
        PRIVATE_PORT_NUM,
        serviceCtx.getPrivateIPAddress(),
        MILLIS_BETWEEN_PORT_AVAILABILITY_RETRIES,
        PORT_AVAILABILITY_TIMEOUT_MILLIS,
    )
    if (waitForPortAvailabilityResult.isErr()) {
        return err(waitForPortAvailabilityResult.error);
    }

    const getUrlsResult = getPrivateAndPublicUrlsForPortId(
        serviceCtx,
        PORT_ID,
        PORT_PROTOCOL,
        "",
    );
    if (getUrlsResult.isErr()) {
        return err(getUrlsResult.error);
    }
    const [privateUrl, publicUrl] = getUrlsResult.value;

    const result: ExplorerFrontendInfo = new ExplorerFrontendInfo(publicUrl);
    return ok(result);
}