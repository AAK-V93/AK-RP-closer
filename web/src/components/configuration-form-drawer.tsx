import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { TrainingSetupForm } from "@/components/training-setup-form";

interface ConfigurationFormDrawerProps {
  children: React.ReactNode;
}

export function ConfigurationFormDrawer({
  children,
}: ConfigurationFormDrawerProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent className="">
        <div className="flex flex-col h-[60vh]">
          <div className="flex-grow overflow-y-auto px-4 py-2">
            <TrainingSetupForm />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
