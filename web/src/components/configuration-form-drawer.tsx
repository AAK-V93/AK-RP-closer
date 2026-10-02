import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
        <DrawerTitle className="sr-only">Cómo practicar</DrawerTitle>
        <DrawerDescription className="sr-only">
          Ajustes de la práctica: prospecto, sección y oferta.
        </DrawerDescription>
        <div className="flex flex-col h-[60vh]">
          <div className="flex-grow overflow-y-auto px-4 py-2">
            <TrainingSetupForm />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
