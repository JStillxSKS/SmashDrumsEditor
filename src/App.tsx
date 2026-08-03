import { ChartEditor } from "./components/ChartEditor";
import { ExportsScreen } from "./components/ExportsScreen";
import { HomeScreen } from "./components/HomeScreen";
import { MobileLayoutGate } from "./components/MobileLayoutGate";
import { ShellNav } from "./components/ShellNav";
import { SidebarDrawer, useSidebarDrawers } from "./components/SidebarDrawer";
import { SidebarLeft } from "./components/SidebarLeft";
import { SidebarRight } from "./components/SidebarRight";
import { Toolbar } from "./components/Toolbar";
import { AuthProvider } from "./context/AuthContext";
import { MobileLayoutProvider } from "./hooks/MobileLayoutProvider";
import { useMobileLayout } from "./hooks/useMobileLayout";
import { useShellStore } from "./store/useShellStore";
import "./styles.css";
import "./styles-future.css";
import "./styles-mobile.css";
import "./styles-shell.css";

function EditorShell() {
  const { isMobileShell, showGate } = useMobileLayout();
  const { leftOpen, rightOpen, toggleLeft, toggleRight, setLeftOpen, setRightOpen } =
    useSidebarDrawers(isMobileShell);

  const closePanels = () => {
    setLeftOpen(false);
    setRightOpen(false);
  };

  return (
    <>
      <MobileLayoutGate open={showGate} />
      <div
        className={`app app--future${isMobileShell ? " app--mobile" : ""}`}
        data-mobile-shell={isMobileShell ? "1" : "0"}
      >
        <div className="app-shell">
          <Toolbar
            isMobileShell={isMobileShell}
            onToggleLeft={toggleLeft}
            onToggleRight={toggleRight}
            leftOpen={leftOpen}
            rightOpen={rightOpen}
          />
          <div
            className="workspace"
            data-left-open={leftOpen}
            data-right-open={rightOpen}
          >
            {isMobileShell && (leftOpen || rightOpen) && (
              <button
                type="button"
                className="mobile-drawer-backdrop"
                aria-label="Close panel"
                onClick={closePanels}
              />
            )}
            <SidebarDrawer side="left" open={leftOpen} onToggle={toggleLeft}>
              <SidebarLeft />
            </SidebarDrawer>
            <div className="editor-main">
              <ChartEditor />
            </div>
            <SidebarDrawer side="right" open={rightOpen} onToggle={toggleRight}>
              <SidebarRight />
            </SidebarDrawer>
          </div>
        </div>
      </div>
    </>
  );
}

function IndiesShell() {
  const mode = useShellStore((s) => s.mode);

  return (
    <div className="shell-root app--future">
      <ShellNav />
      <div
        className={`shell-body${mode === "studio" ? " shell-body--studio" : " shell-body--pane"}`}
      >
        {mode === "home" && <HomeScreen />}
        {mode === "studio" && <EditorShell />}
        {mode === "exports" && <ExportsScreen />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MobileLayoutProvider>
        <IndiesShell />
      </MobileLayoutProvider>
    </AuthProvider>
  );
}
