import { ProspectProfile } from "@/data/training-session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ProspectBriefProps {
  profile: ProspectProfile;
}

export function ProspectBrief({ profile }: ProspectBriefProps) {
  return (
    <Card className="bg-bg0 border-separator1">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {profile.name}, {profile.age} — {profile.occupation}
        </CardTitle>
        <p className="text-xs text-fg3">{profile.location}</p>
      </CardHeader>
      <CardContent className="text-xs space-y-3 text-fg2">
        <Section title="Formulario precalificatorio">
          <Item label="Meta" value={profile.preQualification.mainGoal} />
          <Item label="Situación" value={profile.preQualification.currentSituation} />
          <Item label="Timeline" value={profile.preQualification.timeline} />
          <Item label="Presupuesto" value={profile.preQualification.budgetRange} />
          <Item label="Decisor" value={profile.preQualification.decisionMaker} />
        </Section>
        <Section title="Lo que debiste descubrir">
          <Item label="Dolores" value={profile.pains.join(" · ")} />
          <Item label="Urgencia" value={profile.urgency} />
          <Item label="Deseo" value={profile.desire} />
          <Item label="Intentos previos" value={profile.pastAttempts} />
        </Section>
        <Section title="Objeciones probables">
          <p>{profile.objections.join(" · ")}</p>
        </Section>
        <Section title="Contexto socio / tiempo / dinero">
          <Item label="Pareja" value={profile.partnerSituation} />
          <Item label="Dinero" value={profile.moneySituation} />
          <Item label="Tiempo" value={profile.timeSituation} />
        </Section>
        <p className="text-fg3 italic">{profile.personalityNotes}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-semibold text-fg1 mb-1">{title}</p>
      {children}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-fg3">{label}: </span>
      {value}
    </p>
  );
}
