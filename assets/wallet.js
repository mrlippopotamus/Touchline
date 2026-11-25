import { normaliseAddress } from "./mfl.js";

const FCL_URL = "https://cdn.jsdelivr.net/npm/@onflow/fcl@1.20.1/+esm";
let library;

function flow() {
  if (!library) {
    library = import(FCL_URL).then(fcl => {
      fcl.config({
        "flow.network": "mainnet",
        "accessNode.api": "https://rest-mainnet.onflow.org",
        "discovery.wallet": "https://fcl-discovery.onflow.org/authn",
        "discovery.wallet.method": "IFRAME/RPC",
        "discovery.authn.endpoint": "https://fcl-discovery.onflow.org/api/authn",
        "app.detail.title": "Touchline",
        "app.detail.icon": new URL("./touchline.png", import.meta.url).href,
        "app.detail.url": window.location.origin,
      });
      return fcl;
    }).catch(error => {
      library = undefined;
      throw error;
    });
  }
  return library;
}

export async function watchWallet(onChange) {
  const fcl = await flow();
  return fcl.currentUser.subscribe(user => onChange(user.loggedIn ? normaliseAddress(user.addr) : ""));
}

export async function connectWallet() {
  const fcl = await flow();
  const user = await fcl.authenticate();
  const address = user.loggedIn ? normaliseAddress(user.addr) : "";
  if (!address) throw new Error("The wallet connection was not completed.");
  return address;
}

export async function disconnectWallet() {
  const fcl = await flow();
  await fcl.unauthenticate();
}
