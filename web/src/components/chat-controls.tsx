import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { ConfigurationFormDrawer } from "@/components/configuration-form-drawer";

export function ChatControls() {
  return (
    <div className="absolute top-2 left-2 right-2 flex justify-between">
      <ConfigurationFormDrawer>
        <Button variant="outline" size="icon" className="md:hidden">
          <Settings className="h-4 w-4" />
        </Button>
      </ConfigurationFormDrawer>
    </div>
  );
}
