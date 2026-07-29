import type { GongpilClientBootstrapConfig } from "../../packages/contracts/bootstrap/contracts.ts";
import type { GongpilNetworkRuntime } from "../../platform/network-runtime/src/network-runtime.ts";
import {
  GongpilClientBootstrap,
  type GongpilClientBootstrapResult,
} from "./client-bootstrap.ts";
import type { GongpilCoreProcessExit } from "./core-process-manager.ts";

export type GongpilClientRuntimeState = "idle" | "starting" | "running" | "stopping" | "stopped";

export interface GongpilInstanceRuntimeExit extends GongpilCoreProcessExit {
  reason: "stopped" | "crashed";
}

export class GongpilClientRuntime {
  public constructor(bootstrap: GongpilClientBootstrap) {
    this.bootstrap = bootstrap;
  }

  public async StartInstance(
    config: GongpilClientBootstrapConfig,
  ): Promise<GongpilClientBootstrapResult> {
    if (this.state !== "idle") {
      throw new Error(`Instance Runtime을 시작할 수 없는 Client Runtime 상태입니다: ${this.state}`);
    }

    this.state = "starting";
    try {
      const result = await this.bootstrap.ActivateCore(config);
      this.state = "running";
      return result;
    }
    catch (error) {
      this.state = "idle";
      throw error;
    }
  }

  public async WaitForInstanceExit(): Promise<GongpilInstanceRuntimeExit> {
    if (this.state !== "running") {
      throw new Error(`Instance Runtime 종료를 기다릴 수 없는 Client Runtime 상태입니다: ${this.state}`);
    }

    const exit = await this.bootstrap.WaitForActiveCoreExit();
    if (exit === undefined) {
      throw new Error("실행 중인 Instance Runtime이 없습니다.");
    }
    if (this.state !== "stopped") {
      this.state = "idle";
    }
    return {
      ...exit,
      reason: exit.exitCode === 0 ? "stopped" : "crashed",
    };
  }

  public async StopInstance(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped") {
      return;
    }

    this.state = "stopping";
    try {
      await this.bootstrap.Stop();
    }
    finally {
      this.state = "idle";
    }
  }

  public async Shutdown(): Promise<void> {
    if (this.state === "stopped") {
      return;
    }

    this.state = "stopping";
    try {
      await this.bootstrap.Stop();
    }
    finally {
      this.state = "stopped";
    }
  }

  public GetNetworkRuntime(): GongpilNetworkRuntime {
    return this.bootstrap.GetNetworkRuntime();
  }

  public GetActiveProcessId(): number | undefined {
    return this.bootstrap.GetActiveProcessId();
  }

  public GetState(): GongpilClientRuntimeState {
    return this.state;
  }

  private readonly bootstrap: GongpilClientBootstrap;
  private state: GongpilClientRuntimeState = "idle";
}
