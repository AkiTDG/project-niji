# Niji Faculty Monitoring System

Niji is a web-based faculty locator and monitoring system for a campus community. It gives students and staff one place to find faculty and see whether they are available, in class, in a meeting, or away.

## Purpose

Finding the right faculty member at the right time can be difficult. Niji makes faculty availability and relevant information easier to find, helping students plan when and how to approach professors and helping faculty keep their campus community informed.

## Who uses Niji?

- **Students** can browse the approved faculty directory, search for professors, and view their availability, schedule, and messages to students.
- **Professors** can maintain their profile and schedule, set their current availability, and share a short status message with students. Their directory listing and status controls become available after an administrator approves their account.
- **Administrators** manage professor approval through the Appwrite `Approved Faculty` team.

## Main features

- Separate student and professor accounts, with email/password and Google sign-in.
- Faculty directory with professor search.
- Faculty availability statuses and student-facing status messages.
- Profile onboarding and password recovery.
- Responsive dashboard with light and dark themes.

## Technology

The frontend is built with HTML, CSS, and JavaScript and served locally with Vite. Appwrite provides authentication and backend services; a trusted Appwrite Function handles profile and directory operations.

