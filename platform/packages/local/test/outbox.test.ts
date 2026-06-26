import { InMemoryOutboxStore } from "../src/index.js";
import { runOutboxConformance } from "./outbox-conformance.js";

runOutboxConformance("in-memory outbox", () => new InMemoryOutboxStore());
