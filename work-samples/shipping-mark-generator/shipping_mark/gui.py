"""Tkinter desktop UI: one tab per vendor profile plus a Settings tab."""

from __future__ import annotations

import os
import queue
import re
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from . import config
from .engine import ShippingMarkGenerator

PRIMARY = "#2563eb"
PRIMARY_ACTIVE = "#1d4ed8"
HINT = "#666666"
UI_FONT = "Segoe UI"


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Shipping Mark Generator")
        self.geometry("840x690")
        self.minsize(780, 600)

        self.profiles = config.load_profiles()
        self.log_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.tabs: dict[str, dict] = {}
        self.setting_vars: dict[str, dict[str, tk.StringVar]] = {}

        self._init_style()
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=10)

        for name in config.PROFILES:
            self._build_profile_tab(name)
        self._build_settings_tab()

        self.after(150, self._drain_logs)

    # ------------------------------------------------------------------ #
    def _init_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except tk.TclError:
            pass
        style.configure("TLabel", font=(UI_FONT, 10))
        style.configure("TButton", font=(UI_FONT, 10))
        style.configure("Header.TLabel", font=(UI_FONT, 11, "bold"))
        style.configure("TNotebook.Tab", font=(UI_FONT, 10), padding=(16, 6))

    # ------------------------------------------------------------------ #
    # Profile tabs
    # ------------------------------------------------------------------ #
    def _build_profile_tab(self, name: str) -> None:
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=name)

        ttk.Label(frame, text=f"{name} — generate shipping marks from a packing list",
                  style="Header.TLabel").pack(anchor="w", padx=16, pady=(14, 2))
        ttk.Label(frame, text="1) Browse for the source Excel    2) Enter the PO number    3) Click Generate",
                  foreground=HINT).pack(anchor="w", padx=16, pady=(0, 8))

        box = ttk.LabelFrame(frame, text=" Input ")
        box.pack(fill="x", padx=16, pady=4)
        box.columnconfigure(1, weight=1)

        ttk.Label(box, text="Source Excel file:").grid(row=0, column=0, sticky="w", padx=8, pady=10)
        path_var = tk.StringVar()
        ttk.Entry(box, textvariable=path_var).grid(row=0, column=1, sticky="ew", padx=6, pady=10)
        ttk.Button(box, text="Browse...", width=11,
                   command=lambda v=path_var: self._browse(v)).grid(row=0, column=2, padx=8, pady=10)

        ttk.Label(box, text="PO number:").grid(row=1, column=0, sticky="w", padx=8, pady=(0, 12))
        po_var = tk.StringVar()
        ttk.Entry(box, textvariable=po_var, width=32).grid(row=1, column=1, sticky="w", padx=6, pady=(0, 12))

        button = tk.Button(frame, text="Generate", command=lambda n=name: self._on_generate(n),
                           bg=PRIMARY, fg="white", activebackground=PRIMARY_ACTIVE,
                           activeforeground="white", font=(UI_FONT, 12, "bold"),
                           relief="flat", cursor="hand2", padx=26, pady=10)
        button.pack(anchor="w", padx=16, pady=12)

        progress = ttk.LabelFrame(frame, text=" Progress ")
        progress.pack(fill="both", expand=True, padx=16, pady=(0, 14))
        log = tk.Text(progress, height=14, wrap="word", state="disabled",
                      font=("Consolas", 9), bg="#f7f7f7", relief="flat")
        scrollbar = ttk.Scrollbar(progress, command=log.yview)
        log.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        log.pack(side="left", fill="both", expand=True, padx=4, pady=4)

        self.tabs[name] = {"path": path_var, "po": po_var, "log": log, "button": button}

    def _browse(self, var: tk.StringVar) -> None:
        path = filedialog.askopenfilename(
            title="Select source Excel file",
            filetypes=[("Excel files", "*.xlsx *.xlsm *.xls"), ("All files", "*.*")])
        if path:
            var.set(path)

    def _on_generate(self, name: str) -> None:
        tab = self.tabs[name]
        source = tab["path"].get().strip()
        po_no = tab["po"].get().strip()
        if not source or not os.path.exists(source):
            messagebox.showwarning("Missing file", "Please select a valid source Excel file.")
            return
        if not po_no:
            messagebox.showwarning("Missing PO", "Please enter a PO number.")
            return

        default_name = re.sub(r'[\\/:*?"<>|]', "_", f"ShippingMark_{name}_{po_no}.xlsx")
        output = filedialog.asksaveasfilename(
            title="Save output as", defaultextension=".xlsx",
            initialdir=os.path.dirname(source), initialfile=default_name,
            filetypes=[("Excel files", "*.xlsx")])
        if not output:
            return

        profile = dict(self.profiles[name])
        tab["button"].configure(state="disabled", text="Working...")
        self._clear_log(name)

        def worker() -> None:
            try:
                generator = ShippingMarkGenerator(log=lambda m, n=name: self.log_queue.put((n, m)))
                generator.generate(profile, source, po_no, output)
                self.after(0, lambda: self._finish(name, output, None))
            except Exception as exc:  # noqa: BLE001
                self.log_queue.put((name, f"Failed: {exc}"))
                self.after(0, lambda e=exc: self._finish(name, output, e))

        threading.Thread(target=worker, daemon=True).start()

    def _finish(self, name: str, output: str, error: Exception | None) -> None:
        self.tabs[name]["button"].configure(state="normal", text="Generate")
        if error is None:
            if messagebox.askyesno("Done", f"Saved:\n{output}\n\nOpen the containing folder?"):
                try:
                    os.startfile(os.path.dirname(output))  # noqa: S606 - desktop convenience
                except OSError:
                    pass
        else:
            messagebox.showerror("Error", f"Generation failed:\n{error}")

    # ------------------------------------------------------------------ #
    # Logging
    # ------------------------------------------------------------------ #
    def _clear_log(self, name: str) -> None:
        log = self.tabs[name]["log"]
        log.configure(state="normal")
        log.delete("1.0", "end")
        log.configure(state="disabled")

    def _drain_logs(self) -> None:
        try:
            while True:
                name, message = self.log_queue.get_nowait()
                log = self.tabs[name]["log"]
                log.configure(state="normal")
                log.insert("end", message + "\n")
                log.see("end")
                log.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(150, self._drain_logs)

    # ------------------------------------------------------------------ #
    # Settings tab
    # ------------------------------------------------------------------ #
    def _build_settings_tab(self) -> None:
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text="Settings")

        ttk.Label(frame, text="Field mapping", style="Header.TLabel").pack(anchor="w", padx=16, pady=(14, 4))

        legend = ttk.LabelFrame(frame, text=" Accepted input formats ")
        legend.pack(fill="x", padx=16, pady=4)
        ttk.Label(
            legend, foreground=HINT, font=(UI_FONT, 9), justify="left",
            text=(
                "Every field accepts any of the four formats; the format is detected automatically.\n"
                "1. Single column   - a column letter.            e.g. B, F, AA\n"
                "2. Merged columns  - join with '+'.               e.g. I+J  (non-empty values, space separated)\n"
                "3. Template        - insert column values in {}.  e.g. {J}CM X {K}CM X {L}CM   or   OF {P}\n"
                "4. Literal text    - used verbatim.               e.g. 1PCS OF 1 CTN"
            ),
        ).pack(anchor="w", padx=10, pady=8)

        inner = ttk.Notebook(frame)
        inner.pack(fill="both", expand=True, padx=16, pady=6)
        self._settings_inner = inner

        for name in config.PROFILES:
            tab = ttk.Frame(inner)
            inner.add(tab, text=name)
            tab.columnconfigure(1, weight=1)
            self.setting_vars[name] = {}
            for i, (key, label, hint) in enumerate(config.FIELD_SPECS):
                ttk.Label(tab, text=label).grid(row=i, column=0, sticky="w", padx=(10, 6), pady=6)
                var = tk.StringVar(value=self.profiles[name].get(key, ""))
                ttk.Entry(tab, textvariable=var, width=26).grid(row=i, column=1, sticky="w", padx=6, pady=6)
                ttk.Label(tab, text=hint, foreground=HINT, font=(UI_FONT, 9)).grid(
                    row=i, column=2, sticky="w", padx=6, pady=6)
                self.setting_vars[name][key] = var

        bar = ttk.Frame(frame)
        bar.pack(fill="x", padx=16, pady=12)
        tk.Button(bar, text="Save settings", command=self._save_settings,
                  bg=PRIMARY, fg="white", activebackground=PRIMARY_ACTIVE, activeforeground="white",
                  font=(UI_FONT, 10, "bold"), relief="flat", cursor="hand2",
                  padx=18, pady=6).pack(side="left", padx=(0, 8))
        ttk.Button(bar, text="Reset this profile",
                   command=self._reset_current).pack(side="left", padx=6)
        ttk.Button(bar, text="Reset all", command=self._reset_all).pack(side="left", padx=6)

    def _collect(self) -> None:
        for name in config.PROFILES:
            for key in self.profiles[name]:
                if key in self.setting_vars[name]:
                    self.profiles[name][key] = self.setting_vars[name][key].get().strip()

    def _save_settings(self) -> None:
        self._collect()
        try:
            config.save_profiles(self.profiles)
            messagebox.showinfo("Saved", f"Settings saved to:\n{config.settings_path()}")
        except OSError as exc:
            messagebox.showerror("Error", f"Could not save settings:\n{exc}")

    def _refresh(self, name: str) -> None:
        for key, var in self.setting_vars[name].items():
            var.set(self.profiles[name].get(key, ""))

    def _reset_current(self) -> None:
        index = self._settings_inner.index(self._settings_inner.select())
        name = config.PROFILES[index]
        self.profiles[name] = dict(config.DEFAULT_PROFILES[name])
        self._refresh(name)
        messagebox.showinfo("Reset", f"{name} restored to defaults. Click 'Save settings' to persist.")

    def _reset_all(self) -> None:
        if not messagebox.askyesno("Confirm", "Reset every profile to its defaults?"):
            return
        for name in config.PROFILES:
            self.profiles[name] = dict(config.DEFAULT_PROFILES[name])
            self._refresh(name)
        messagebox.showinfo("Reset", "All profiles restored to defaults. Click 'Save settings' to persist.")


def main() -> None:
    App().mainloop()
