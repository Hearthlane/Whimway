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
      <h2>In the Whimway app.</h2>
      <p>
        The app keeps your taste profile, plans and feedback on your device.
        “Near me” asks for your location once, rounds it to about 100 metres and
        uses it only as the planning area. Usage statistics (for example “plan
        saved”) are sent only if you allow them, with a random install ID and
        never your prompts, places or location.
      </p>
      <h2>Polls, reactions and community signals.</h2>
      <p>
        When you answer a poll, tap 👍/👎 on a plan or stop, or rate an outing,
        an anonymous vote (a random install ID, a venue type or place ID, and up
        or down) is stored to learn what people enjoy. Results are only used in
        aggregate, a venue or category only counts once at least five different
        people have reacted, and nobody can read individual votes. Re-voting
        replaces your earlier vote.
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
