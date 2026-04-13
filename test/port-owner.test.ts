import { describe, expect, it } from "vitest";

import {
  parseLsofListeningPortOwner,
  parseNetstatListeningPortPid,
  parseSsListeningPortOwner,
} from "../packages/cli/src/port-owner.ts";

describe("port owner parsers", () => {
  it("parses lsof output", () => {
    const owner = parseLsofListeningPortOwner(
      [
        "COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
        "node    48121 fang   21u  IPv4 0x123456789abcdef      0t0  TCP 127.0.0.1:42110 (LISTEN)",
      ].join("\n"),
    );

    expect(owner).toEqual({
      source: "lsof",
      command: "node",
      pid: 48121,
      raw: "node    48121 fang   21u  IPv4 0x123456789abcdef      0t0  TCP 127.0.0.1:42110 (LISTEN)",
    });
  });

  it("parses ss output", () => {
    const owner = parseSsListeningPortOwner(
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess\nLISTEN 0      511    127.0.0.1:42110      0.0.0.0:*    users:(("node",pid=48121,fd=21))',
    );

    expect(owner).toEqual({
      source: "ss",
      command: "node",
      pid: 48121,
      raw: 'LISTEN 0      511    127.0.0.1:42110      0.0.0.0:*    users:(("node",pid=48121,fd=21))',
    });
  });

  it("parses netstat output", () => {
    const pid = parseNetstatListeningPortPid(
      [
        "  Proto  Local Address          Foreign Address        State           PID",
        "  TCP    127.0.0.1:42110       0.0.0.0:0              LISTENING       48121",
      ].join("\n"),
      42110,
    );

    expect(pid).toBe(48121);
  });
});
