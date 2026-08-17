// Transcribed by hand from ../../../data/resources.md, which is itself
// hand-curated and never touched by the hourly pipeline (see that file's
// own note). Keep this in sync by hand on the same schedule — same
// convention CLAUDE.md already documents for CONTRIBUTING.md/SOURCES.md
// staying in sync with the pipeline they describe.

export interface ResourceLink {
  name: string;
  url: string;
  description: string;
}

export interface ResourceCategory {
  id: string;
  title: string;
  items: ResourceLink[];
}

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  {
    id: "coding-practice",
    title: "Coding Practice",
    items: [
      { name: "LeetCode", url: "https://leetcode.com/", description: "The standard coding-interview question bank, company-tagged" },
      { name: "NeetCode", url: "https://neetcode.io/", description: "The same style of problems organized by pattern, with free video explanations" },
      { name: "HackerRank", url: "https://www.hackerrank.com/", description: "Practice problems plus skill-certification tests some employers accept directly" },
      { name: "Codeforces", url: "https://codeforces.com/", description: "Competitive programming contests and a huge archive of rated problems" },
      { name: "CodeChef", url: "https://www.codechef.com/", description: "Competitive programming with strong reach across Asia" },
      { name: "Exercism", url: "https://exercism.org/", description: "Language-by-language practice with real human mentor feedback" },
      { name: "Codewars", url: "https://www.codewars.com/", description: "Bite-sized kata-style problems, good for daily practice" },
    ],
  },
  {
    id: "mock-interviews",
    title: "Mock Interviews",
    items: [
      { name: "Pramp", url: "https://www.pramp.com/", description: "Free peer-to-peer mock interviews, paired automatically" },
      { name: "interviewing.io", url: "https://interviewing.io/", description: "Anonymous mock interviews with real engineers from top companies" },
      { name: "Exponent", url: "https://www.tryexponent.com/", description: "Mock interview practice and courses for SWE, PM, and data roles" },
      { name: "Big Interview", url: "https://biginterview.com/", description: "Structured mock interview practice with recorded playback" },
    ],
  },
  {
    id: "system-design",
    title: "System Design & CS Fundamentals",
    items: [
      { name: "System Design Primer", url: "https://github.com/donnemartin/system-design-primer", description: "The most-starred free guide to system design interviews" },
      { name: "ByteByteGo", url: "https://bytebytego.com/", description: "System design explained through newsletters and diagrams" },
      { name: "CS50", url: "https://cs50.harvard.edu/x/", description: "Harvard's free, famous intro to computer science course" },
    ],
  },
  {
    id: "resume",
    title: "Resume & Applications",
    items: [
      { name: "Tech Interview Handbook", url: "https://www.techinterviewhandbook.org/", description: "Free guide covering resumes, behavioral questions, and interview strategy" },
      { name: "Resume Worded", url: "https://resumeworded.com/", description: "Free resume and LinkedIn profile scoring against ATS filters" },
      { name: "Kickresume", url: "https://www.kickresume.com/", description: "Resume builder with templates aimed at tech roles" },
      { name: "Teal", url: "https://www.tealhq.com/", description: "Resume builder plus a job-application tracker" },
      { name: "Grammarly", url: "https://www.grammarly.com/", description: "Grammar and clarity checker for resumes and cover letters" },
      { name: "zapplyjobs/resume-samples-2026", url: "https://github.com/zapplyjobs/resume-samples-2026", description: "Free, ATS-friendly resume templates aimed at new-grad tech applications" },
      { name: "zapplyjobs/interview-handbook-2026", url: "https://github.com/zapplyjobs/interview-handbook-2026", description: "Behavioral-interview prep, including STAR-method answer structuring" },
    ],
  },
  {
    id: "portfolio",
    title: "Project Ideas & Portfolio",
    items: [
      { name: "codecrafters-io/build-your-own-x", url: "https://github.com/codecrafters-io/build-your-own-x", description: "Tutorials for building real systems from scratch (a Docker, a Git, a database) — strong portfolio material for junior applicants" },
    ],
  },
  {
    id: "learning",
    title: "Learning Platforms",
    items: [
      { name: "freeCodeCamp", url: "https://www.freecodecamp.org/", description: "Free, project-based curriculum from basics through full-stack" },
      { name: "The Odin Project", url: "https://www.theodinproject.com/", description: "Free, structured full-stack web development path" },
      { name: "Coursera", url: "https://www.coursera.org/", description: "University-taught courses; many free to audit" },
      { name: "Udacity", url: "https://www.udacity.com/", description: "Project-based \"nanodegree\" tracks, including free courses" },
    ],
  },
  {
    id: "open-source",
    title: "Open-Source & Fellowship Programs",
    items: [
      { name: "Google Summer of Code", url: "https://summerofcode.withgoogle.com/", description: "Paid summer open-source contributions with mentor orgs" },
      { name: "Hacktoberfest", url: "https://hacktoberfest.com/", description: "Beginner-friendly open-source contribution drive every October" },
      { name: "MLH Fellowship", url: "https://fellowship.mlh.io/", description: "Paid remote software engineering fellowship, open-source and industry tracks" },
      { name: "Outreachy", url: "https://www.outreachy.org/", description: "Paid open-source internships for people from underrepresented groups" },
    ],
  },
  {
    id: "salary",
    title: "Salary & Offer Data",
    items: [
      { name: "Levels.fyi", url: "https://www.levels.fyi/", description: "Crowdsourced compensation data to benchmark and negotiate offers" },
      { name: "Blind", url: "https://www.teamblind.com/", description: "Anonymous, verified-employee community for company and offer discussion" },
    ],
  },
  {
    id: "other-trackers",
    title: "Other Job Trackers Worth Knowing",
    items: [
      { name: "simplify.jobs", url: "https://simplify.jobs/", description: "The company behind the SimplifyJobs GitHub lists; one-click autofill applications" },
      { name: "SimplifyJobs/New-Grad-Positions", url: "https://github.com/SimplifyJobs/New-Grad-Positions", description: "The single most-used community new-grad tracker on GitHub — tracker already pulls from this directly" },
      { name: "SimplifyJobs/Summer2026-Internships", url: "https://github.com/SimplifyJobs/Summer2026-Internships", description: "Its internship-focused counterpart — tracker already pulls from this directly" },
      { name: "vanshb03/New-Grad-2027", url: "https://github.com/vanshb03/New-Grad-2027", description: "Another widely-used new-grad tracker — tracker already pulls from this directly" },
      { name: "vanshb03/Summer2027-Internships", url: "https://github.com/vanshb03/Summer2027-Internships", description: "Its internship-focused counterpart — tracker already pulls from this directly" },
      { name: "swelist.com", url: "https://swelist.com/", description: "A hosted internship board with email alerts when new roles are posted" },
    ],
  },
];
