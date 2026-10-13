export default function Page() {
  return (
    <article className="wrap legal-page">
      <div className="eyebrow">
        DRAFT · LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH
      </div>
      <h1>Privacy, thoughtfully.</h1>
      <p>
        Whimway sends your selected exploration area, outing request and
        constraints to Google Maps Platform and OpenAI to retrieve places and
        design your outing. Review those providers’ privacy policies before
        using their services.
      </p>
      <h2>Your choices stay yours.</h2>
      <p>
        Guest plans and optional preferences stay in this browser until you
        delete them. Device plans store Place IDs, visit order, duration and
        your choices; venue details and photographs are refreshed. Cloud plans
        and preferences are stored in Supabase only when you sign in and choose
        to save them.
      </p>
      <h2>Location and sharing.</h2>
      <p>
        Browser location is requested only after you choose Use my location.
        Share links make stop IDs, visit times, plan titles and a map area
        derived from public stops public to anyone with the link. Private
        prompts, dietary and accessibility requirements and personal route
        anchors are removed. You may revoke links; deleting a cloud plan removes
        its links.
      </p>
      <h2>Usage and deletion.</h2>
      <p>
        Server logs record event names and timestamps, without prompts or
        precise locations. Rate limiting stores hashed network identifiers for
        up to 24 hours. No advertising analytics are installed. Delete device
        data, preferences, plans or your account from Profile and Saved. Contact
        details, controller identity, retention schedules, international
        transfer terms and jurisdiction-specific rights must be completed by the
        operator before launch.
      </p>
    </article>
  );
}
