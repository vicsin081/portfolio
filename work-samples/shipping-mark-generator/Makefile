# Convenience targets (cross-platform; requires GNU Make)
PYTHON ?= python

.PHONY: help install run sample build clean

help:
	@echo "make install   Install runtime dependencies"
	@echo "make run       Launch the app from source"
	@echo "make sample    Generate sample_packing_list.xlsx"
	@echo "make build     Build a single-file executable (dist/)"
	@echo "make clean     Remove build artifacts"

install:
	$(PYTHON) -m pip install -r requirements.txt

run:
	$(PYTHON) -m shipping_mark

sample:
	$(PYTHON) scripts/make_sample_data.py

build:
	$(PYTHON) -m pip install -r requirements-dev.txt
	pyinstaller --noconfirm --onefile --windowed --name ShippingMark app.py

clean:
	rm -rf build dist *.spec __pycache__ shipping_mark/__pycache__
