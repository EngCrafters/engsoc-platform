import { pluralEn } from "../plural";

/**
 * English interface copy. The Arabic dictionary has the same shape (TypeScript enforces it),
 * so a string added here must be translated before the project builds. Copy that belongs to a
 * piece of content (an event, a discipline, an activity) lives with that content instead.
 */
export const en = {
  meta: {
    title: "Engineering Society — Sultan Qaboos University",
    description:
      "The Engineering Society at Sultan Qaboos University — discover events, share projects, preserve achievements and connect across engineering disciplines.",
    aboutTitle: "About — Engineering Society",
    aboutDescription:
      "About the Engineering Society at Sultan Qaboos University: who we are, and how the society is organised.",
    archiveTitle: "Previous Activities — Engineering Society",
    archiveDescription:
      "Past editions of the Engineering Society’s programmes at Sultan Qaboos University.",
  },

  site: {
    name: "Engineering Society",
    affiliation: "Sultan Qaboos University",
    eyebrow: "Engineering Society · Sultan Qaboos University",
  },

  common: {
    skipToContent: "Skip to content",
    sample: "Sample",
    preview: "Preview",
    close: "Close",
    opensInNewTab: "(opens in a new tab)",
    photoToCome: "Photograph to come",
    toBeAnnounced: "To be announced",
    /** Joins a date and a time: "Mon 12 Oct 2026, 16:00–18:00". */
    comma: ", ",
  },

  nav: {
    sectionsLabel: "Sections",
    links: {
      events: "Events",
      projects: "Projects",
      disciplines: "Disciplines",
      activities: "Activities",
      about: "About",
    },
    join: "Join the Society",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    backToTop: ", back to top",
    home: ", home",
    language: "Language",
    switchTo: "Switch to English",
    /** The platform's real sign-in: the committee administration area. */
    signIn: "Committee sign in",
  },

  hero: {
    titleStart: "Where ideas",
    titleEnd: "take shape",
    lead: "Meet the people, build the projects, and discover the experiences that move your engineering journey forward.",
    exploreEvents: "Explore Events",
    discoverProjects: "Discover Projects",
    caption: "Different disciplines, one society.",
  },

  stats: {
    title: "The society at a glance",
    factsTitle: "The society in brief",
    placeholder: "Verified figure to come",
    pendingNote:
      "Figures appear here once they are confirmed from the society’s records and the site’s analytics.",
    demoTag: "Demo figure",
    demoNote:
      "Demonstration figures for preview only, not verified society statistics.",
    yearRange: (from: number, to: number) => `${from} to ${to}`,
    seeNote: (n: number) => `(see note ${n})`,
    note: (n: number) => `Note ${n}:`,
  },

  overview: {
    more: "More about the society",
  },

  events: {
    title: "Find your next experience.",
    sampleStrong: "Sample listings.",
    sampleBody:
      "No events have been published on the platform yet; these show how they will appear.",
    alsoComingUp: "Also coming up",
    empty:
      "No events are scheduled right now. New workshops and talks will appear here as committees publish them.",
    dateTime: "Date and time",
    location: "Location",
    featured: "Featured",
    timezone: "Oman time (UTC+4)",
    types: {
      workshop: "Workshop",
      talk: "Talk",
      "site-visit": "Site visit",
      competition: "Competition",
    },
    registration: {
      open: "Registration open",
      waitlist: "Waitlist only",
      closed: "Registration closed",
      preview: "Registration opens with Phase 1",
    },
    previewRegistration: "Preview registration",
    previewFor: (label: string, title: string) => `${label} for ${title}`,
    dialogTitle: "Registration isn’t open yet",
    dialogSample:
      " is a sample listing. When event registration launches in Phase 1, you’ll register right here and see your confirmation instantly on the same page.",
    dialogNothing:
      "Nothing has been submitted, and no place has been reserved.",

    /* Canonical public event surface. These labels describe live database rows,
       not samples: the platform's own events are the only source. */
    upcoming: "Upcoming events",
    past: "Past events",
    viewAll: "View all events",
    backToEvents: "All events",
    organisedBy: "Organised by",
    aboutEvent: "About this event",
    locationTbc: "Location to be confirmed",
    noUpcoming: "No events are scheduled right now.",
    noUpcomingBody:
      "New workshops and talks appear here as committees publish them.",
    noPast: "No past events",
    noPastBody: "There are no past events to show yet.",
    moreUpcoming: "More upcoming events",
    morePast: "More past events",
    /* Availability comes from the database, derived server-side. */
    availability: {
      open: "Registration open",
      waitlist: "Full — join the waitlist",
      closed: "Registration closed",
    },
  },

  /**
   * The platform's real registration flow. These strings are the only user-facing
   * surface of the canonical registerForEvent contract, so every result code in
   * lib/registrations/types.ts has a translation here.
   */
  registration: {
    heading: "Register for this event",
    headingWaitlist: "Join the waitlist",
    headingClosed: "Registration closed",
    intro:
      "No account is needed. Your name and email are used only for event administration.",
    introWaitlist:
      "Places are full or being allocated. Joining the waitlist does not confirm a place.",
    introClosed:
      "This event has already started. New registrations and waitlist entries are closed.",
    name: "Name",
    email: "Email address",
    register: "Register",
    joinWaitlist: "Join waitlist",
    submitting: "Submitting…",
    submittingSr: "Submitting registration",
    successConfirmed: "You’re registered. Your place is confirmed.",
    successWaitlisted:
      "You’re on the waitlist, not yet registered for a place. The committee will contact you if a place can be offered.",
    errors: {
      invalid_name: "Enter your name.",
      invalid_email: "Enter a valid email address.",
      invalid_event: "This event is unavailable.",
      event_not_found: "This event is unavailable.",
      event_not_published: "This event is unavailable.",
      event_full:
        "Registration is full or places are being allocated to the waitlist.",
      rate_limited:
        "Too many attempts from this connection. Try again after 10 minutes.",
      already_registered:
        "This email is already registered for this event. No second registration was created.",
      already_waitlisted:
        "This email is already on the waitlist. No second entry was created.",
      registration_closed:
        "Registration has closed because this event has started.",
      invalid_intent: "Choose a valid registration option.",
      invalid_ip: "We couldn’t verify this request. Try again.",
      invalid_input: "Check the form and try again.",
      server_error:
        "We couldn’t confirm the result. Try again; retrying won’t create another entry.",
      registration_available:
        "Registration is open again. Choose Register to confirm your place.",
    },
  },

  projects: {
    title: "Built by our community.",
    lead: "Projects and publications, kept with their discipline, year and team so each generation can build on the last instead of starting over.",
    sampleStrong: "Sample entries.",
    sampleBody:
      "The archive opens in Phase 3; these examples show how finished work will be preserved.",
    filterLabel: "Filter projects by discipline",
    all: "All",
    showingAll: (n: number) => `Showing all ${n} sample projects`,
    showingIn: (n: number, discipline: string) =>
      `Showing ${pluralEn(n, "sample project", "sample projects")} in ${discipline}`,
    alsoInArchive: "Also in the archive",
    onlyOne: "This is the only sample project in this discipline.",
    archiveOpens: "Full archive entry opens in Phase 3",
    discipline: "Discipline",
    year: "Year",
    team: "Team",
    teamOf: (n: number) => `Team of ${n}`,
  },

  disciplines: {
    title: "Different disciplines. Shared ambition.",
    sampleProjects: "Sample projects",
    sampleProjectsIn: (name: string) => `Sample projects in ${name}`,
  },

  activities: {
    title: "Engineering Society Activities",
    lead: "Explore the programmes, gatherings, and experiences that bring our community together.",
    figuresStrong: "Programme figures to come.",
    figuresBody:
      "They’ll appear with each programme once the society confirms them.",
    photosStrong: "Photographs and figures to come.",
    photosBody:
      "They’ll appear with each programme once the society supplies and confirms them.",
    explorePrevious: "Explore Previous Activities",
    previousEditions: "Previous editions",
    demoStrong: "Demonstration events.",
    demoBody:
      "Titles, dates and attendance are samples showing how past events will appear; the photographs are the society’s own.",
    demo: "Demo",
    date: "Date",
    attendance: "Attendance",
    attendees: (n: number, shown: string) =>
      `${shown} ${n === 1 ? "attendee" : "attendees"}`,
    visitors: (n: number, shown: string) =>
      `${shown} ${n === 1 ? "visitor" : "visitors"}`,
    slideOf: (i: number, n: number) => `${i} of ${n}`,
    showSlide: (i: number, title: string) => `Show slide ${i}: ${title}`,
    pause: "Pause slideshow",
    play: "Play slideshow",
  },

  leadership: {
    title: "Meet the Society’s Leadership",
    rosterStrong: "Roster to be announced.",
    rosterBody:
      "Names, portraits and the current term will appear here once the society confirms them.",
    viewStructure: "View the Full Society Structure",
    seniorLeadership: "Senior leadership",
    vicePresidents: "Vice Presidents",
    nameToBeAnnounced: "Name to be announced",
  },

  structure: {
    title: "How the society is organised",
    lead: "Senior leadership sets the direction; committees and their teams carry the society’s work.",
    rosterStrong: "Roster to be announced.",
    rosterBody:
      "Names, portraits, committee chairs and deputies will be added once the society confirms its current roster.",
    committees: "Committees",
    teamsIn: (committee: string) => `Teams in the ${committee}`,
  },

  join: {
    title: "Make your next idea a shared one",
    body: "Membership starts with one permanent profile: your events, certificates and projects in one place, carried forward every year. Member registration is part of the platform’s first release.",
    join: "Join the Society",
    exploreEvents: "Explore Events",
    dialogTitle: "Membership registration opens soon",
    dialogIntro:
      "Registration isn’t open on this site yet, and nothing you do here is submitted.",
    dialogWhenOpen: "When it opens, you’ll:",
    dialogSteps: [
      "create one profile with your name, university email, student ID, year and major;",
      "receive a confirmation email with your platform login;",
      "keep that same profile, and its history, every year after.",
    ],
    dialogNext: "Explore events",
  },

  footer: {
    tagline: "Discover events, share projects, preserve achievements.",
    studentSocietyAt: "A student society at",
    squAlt: "Sultan Qaboos University",
    follow: "Follow the Society",
    linkToCome: "Link to come",
    navLabel: "Footer",
    copyright: (year: number, name: string, affiliation: string) =>
      `© ${year} ${name}, ${affiliation}.`,
    previewSite: "Preview site. Platform features arrive in phases.",
  },

  about: {
    title: "About the society",
    lead: "A student-run organisation at the College of Engineering, and the umbrella for the college’s seven engineering societies.",
  },

  archive: {
    eyebrow: "Engineering Society Activities",
    title: "Previous Activities",
    lead: "A record of past editions of the society’s programmes, by programme and year.",
    regionLabel: "Archive of previous activities",
    emptyTitle: "No previous activities have been archived yet.",
    emptyBody:
      "As the society documents past editions of its programmes, each will be listed here by programme and year, with photographs where available.",
    back: "Back to Activities",
    toBeArchived: "Programmes to be archived",
    filterProgramme: "Filter by programme",
    filterYear: "Filter by year",
    allProgrammes: "All programmes",
    allYears: "All years",
    showing: (n: number) => `Showing ${pluralEn(n, "edition", "editions")}`,
    noMatch: "No editions match these filters.",
    viewEdition: "View this edition",
  },
};

export type Dictionary = typeof en;
