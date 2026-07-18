import { WizardPage } from '@/components/wizard/WizardPage';

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WizardPage reportId={id} />;
}
