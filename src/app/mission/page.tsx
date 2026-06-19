import { redirect } from 'next/navigation';

// The standalone Mission launcher was a stepping stone (#151). The launch now
// lives inside the roundtable room ("Start a mission" → NewTaskModal), so the
// Mission flow is one continuous surface (#155 / spec 110 §7 step 4). Keep the
// path as a redirect for any existing links.
export default function MissionPage() {
  redirect('/');
}
