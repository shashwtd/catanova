#!/usr/bin/env bash
# Fresh Ubuntu 24.04 Azure host only. No Azure API calls or app deployment.
# First run: sudo bash bootstrap.sh --initialize-new-disk
# The operator must first verify LUN0 is the NEW empty 32-GiB managed disk.
# Existing disks/VMs are not migrated. Reruns use the recorded filesystem UUID.
# Sources:
# https://docs.docker.com/engine/install/ubuntu/
# https://docs.docker.com/engine/daemon/#daemon-data-directory
# https://learn.microsoft.com/en-us/azure/virtual-machines/linux/attach-disk-portal
set -Eeuo pipefail
umask 022

die() { printf 'Bootstrap stopped: %s\n' "$*" >&2; exit 1; }
initialize=false
case "${1:-}" in
  --initialize-new-disk) initialize=true ;;
  '') ;;
  *) die 'Usage: sudo bash bootstrap.sh [--initialize-new-disk]' ;;
esac
[[ $# -le 1 ]] || die 'Unexpected arguments.'
[[ $EUID -eq 0 ]] || die 'Run as root on the new Ubuntu VM.'
[[ -f /etc/os-release ]] || die 'Missing OS identification.'
# shellcheck source=/dev/null
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || die 'Only Ubuntu 24.04 is supported.'
[[ $(dpkg --print-architecture) == amd64 ]] || die 'Expected the approved x64 VM.'
[[ -d /run/systemd/system ]] || die 'A systemd host is required.'
for command in flock lsblk blkid blockdev wipefs findmnt mountpoint mkfs.ext4 udevadm python3; do
  command -v "$command" >/dev/null || die "Missing Ubuntu utility: $command"
done
exec 9>/run/catanova-bootstrap.lock
flock -n 9 || die 'Another bootstrap is running.'

readonly mount_dir=/srv/catanova
readonly state_dir=/etc/catanova
readonly uuid_file=$state_dir/data-disk.uuid
readonly disk_link=/dev/disk/azure/scsi1/lun0
[[ -L $disk_link && -b $disk_link ]] || die 'Azure SCSI LUN0 disk alias is missing; refusing to guess a device.'
disk=$(readlink -f "$disk_link")
[[ $(lsblk -dnro TYPE "$disk") == disk ]] || die 'LUN0 is not a whole disk.'
[[ $(blockdev --getsize64 "$disk") == 34359738368 ]] || die 'Expected exactly 32 GiB at LUN0.'
[[ $(lsblk -nrpo NAME "$disk" | wc -l) -eq 1 ]] || die 'LUN0 has partitions or dependent devices.'
[[ -z $(find "/sys/class/block/$(basename "$disk")/holders" -mindepth 1 -maxdepth 1 -print -quit) ]] || die 'LUN0 has active device holders.'
root_device=$(findmnt -nro SOURCE /)
[[ -b $root_device ]] || die 'Cannot identify the OS block device safely.'
if lsblk -snrpo NAME "$root_device" | awk -v candidate="$disk" '$0 == candidate { found=1 } END { exit !found }'; then
  die 'LUN0 is part of the OS disk.'
fi
for path in /srv "$mount_dir" "$state_dir" "$uuid_file" /etc/fstab /etc/docker /etc/containerd; do
  [[ ! -L $path ]] || die "Unexpected symlink: $path"
done

installed() { [[ $(dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true) == 'install ok installed' ]]; }
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  ! installed "$package" || die "Existing conflicting package $package; refusing to remove it."
done
if [[ ! -f $uuid_file ]]; then
  for package in docker-ce docker-ce-cli containerd.io; do
    ! installed "$package" || die 'Docker is already installed on an unmanaged host.'
  done
fi
for path in /var/lib/docker /var/lib/containerd; do
  [[ ! -L $path ]] || die "Unexpected symlink: $path"
  [[ ! -d $path || -z $(find "$path" -mindepth 1 -maxdepth 1 -print -quit) ]] || die "Existing data in $path; this script does not migrate it."
done

if [[ -f $uuid_file ]]; then
  [[ $(stat -c %u "$uuid_file") == 0 ]] || die 'Disk identity file is not root-owned.'
  disk_uuid=$(cat "$uuid_file")
  [[ $disk_uuid =~ ^[0-9a-f-]{36}$ ]] || die 'Invalid recorded disk UUID.'
  [[ $(blkid -s UUID -o value "$disk") == "$disk_uuid" && $(blkid -s TYPE -o value "$disk") == ext4 ]] || die 'LUN0 does not match the previously initialized ext4 disk.'
else
  $initialize || die 'First initialization requires --initialize-new-disk after verifying the new Azure disk.'
  [[ -z $(lsblk -nrpo MOUNTPOINTS "$disk" | tr -d '[:space:]') ]] || die 'LUN0 is mounted.'
  [[ -z $(wipefs --no-act --noheadings --output TYPE "$disk") ]] || die 'LUN0 contains a filesystem or partition signature.'
  if blkid -p "$disk" >/dev/null 2>&1; then
    die 'LUN0 contains recognized data.'
  else
    [[ $? -eq 2 ]] || die 'Disk signature probing failed.'
  fi
  [[ ! -e $mount_dir || -d $mount_dir ]] || die 'Mount path is not a directory.'
  [[ ! -d $mount_dir || -z $(find "$mount_dir" -mindepth 1 -maxdepth 1 -print -quit) ]] || die 'Mount path contains existing data.'
  # Signatures cannot establish raw-disk provenance. The explicit flag asserts
  # the operator verified this exact LUN0 resource was newly created empty.
  printf 'Initializing the verified new 32-GiB LUN0 disk.\n'
  # One -F permits the deliberate whole-disk filesystem; never use -F twice.
  mkfs.ext4 -F -L catanova-data -m 0 "$disk"
  udevadm settle
  disk_uuid=$(blkid -s UUID -o value "$disk")
  [[ $disk_uuid =~ ^[0-9a-f-]{36}$ ]] || die 'New filesystem UUID is missing.'
  install -d -m 0755 "$state_dir"
  printf '%s\n' "$disk_uuid" >"$uuid_file"
  chmod 0600 "$uuid_file"
  sync "$uuid_file"
fi

if mountpoint -q "$mount_dir"; then
  [[ $(findmnt -nro UUID --mountpoint "$mount_dir") == "$disk_uuid" ]] || die 'A different filesystem is mounted at /srv/catanova.'
else
  [[ -z $(lsblk -nrpo MOUNTPOINTS "$disk" | tr -d '[:space:]') ]] || die 'The data disk is mounted elsewhere.'
  [[ ! -d $mount_dir || -z $(find "$mount_dir" -mindepth 1 -maxdepth 1 -print -quit) ]] || die 'The unmounted path contains data; refusing to hide it.'
  install -d -m 0755 "$mount_dir"
fi
fstab_line="UUID=$disk_uuid $mount_dir ext4 defaults,nofail,x-systemd.device-timeout=15s 0 2"
existing_entry=$(awk -v source="UUID=$disk_uuid" -v target="$mount_dir" '$0 !~ /^[[:space:]]*#/ && ($1 == source || $2 == target)' /etc/fstab)
if [[ -n $existing_entry ]]; then
  [[ $existing_entry == "$fstab_line" ]] || die 'An existing fstab entry conflicts with this data disk.'
else
  [[ -e /etc/fstab.catanova-before-bootstrap ]] || cp -p /etc/fstab /etc/fstab.catanova-before-bootstrap
  printf '\n%s\n' "$fstab_line" >>/etc/fstab
fi
systemctl daemon-reload
mountpoint -q "$mount_dir" || mount "$mount_dir"
[[ $(findmnt -nro UUID --mountpoint "$mount_dir") == "$disk_uuid" ]] || die 'Data-disk mount verification failed.'

work_dir=$(mktemp -d /run/catanova-bootstrap.XXXXXX)
trap 'rm -rf -- "$work_dir"' EXIT
write_managed() {
  local destination=$1
  cat >"$work_dir/managed"
  [[ ! -L $destination ]] || die "Unexpected config symlink: $destination"
  if [[ -e $destination ]]; then
    cmp -s "$work_dir/managed" "$destination" || die "Existing config differs: $destination; refusing to replace it."
  else
    install -D -m 0644 "$work_dir/managed" "$destination"
  fi
}

# Configure both stores and mount guards before apt can auto-start services.
install -d -m 0711 "$mount_dir/docker" "$mount_dir/containerd"
write_managed /etc/docker/daemon.json <<'DOCKER'
{
  "data-root": "/srv/catanova/docker",
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
DOCKER
write_managed /etc/containerd/config.toml <<'CONTAINERD'
version = 2
root = "/srv/catanova/containerd"
state = "/run/containerd"
CONTAINERD
for service in docker containerd; do
  write_managed "/etc/systemd/system/$service.service.d/catanova-storage.conf" <<'UNIT'
[Unit]
RequiresMountsFor=/srv/catanova
BindsTo=srv-catanova.mount
After=srv-catanova.mount
ConditionPathIsMountPoint=/srv/catanova
UNIT
done
systemctl daemon-reload

packages=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
missing=()
for package in "${packages[@]}"; do
  installed "$package" || missing+=("$package")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends --no-upgrade ca-certificates curl
  install -d -m 0755 /etc/apt/keyrings
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 \
    https://download.docker.com/linux/ubuntu/gpg -o "$work_dir/docker.asc"
  write_managed /etc/apt/keyrings/docker.asc <"$work_dir/docker.asc"
  write_managed /etc/apt/sources.list.d/docker.sources <<'APT'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
APT
  apt-get update
  # Preserve the intentional containerd config if its package ships a default.
  apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold "${missing[@]}"
fi

dockerd --validate --config-file=/etc/docker/daemon.json
systemctl enable containerd.service docker.service
systemctl start containerd.service docker.service
[[ $(docker info --format '{{.DockerRootDir}}') == "$mount_dir/docker" ]] || die 'Docker is using the wrong data root.'
containerd --config /etc/containerd/config.toml config dump >"$work_dir/containerd.toml"
python3 - "$work_dir/containerd.toml" <<'PYTHON' || die 'Containerd is using the wrong configured data root.'
import sys
import tomllib
with open(sys.argv[1], 'rb') as source:
    config = tomllib.load(source)
sys.exit(0 if config.get('root') == '/srv/catanova/containerd' else 1)
PYTHON
docker compose version
printf 'Host ready. Persistent Docker/containerd storage: /srv/catanova. No app has been deployed.\n'
