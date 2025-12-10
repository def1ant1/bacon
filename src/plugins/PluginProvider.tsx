import React, { createContext, useContext, useMemo } from "react";
import { BaconPlugin, PluginRunner, PluginRuntimeContext } from "./BaconPlugin";

const PluginRunnerContext = createContext<PluginRunner | null>(null);

export interface PluginProviderProps {
  plugins?: BaconPlugin[];
  context: PluginRuntimeContext;
  runner?: PluginRunner;
  children: React.ReactNode;
}

export const PluginProvider: React.FC<PluginProviderProps> = ({
  plugins = [],
  context,
  runner: runnerProp,
  children,
}) => {
  const computed = useMemo(
    () => runnerProp ?? new PluginRunner(plugins, context),
    [runnerProp, plugins, context],
  );
  return <PluginRunnerContext.Provider value={computed}>{children}</PluginRunnerContext.Provider>;
};

export function usePluginRunner(): PluginRunner | null {
  return useContext(PluginRunnerContext);
}
